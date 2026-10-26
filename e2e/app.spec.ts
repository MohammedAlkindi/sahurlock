import { expect, test } from '@playwright/test';

const ROUTES = ['/', '/session', '/timer', '/stats', '/schedule', '/tasks', '/notes', '/flashcards', '/scan', '/sounds', '/settings', '/privacy', '/terms'];

test('no route breaks the Content Security Policy', async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = seen;
    document.addEventListener('securitypolicyviolation', (e) => seen.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  for (const route of ROUTES) {
    const response = await page.goto(route, { waitUntil: 'networkidle' });
    expect(response?.headers()['content-security-policy']).toContain("default-src 'self'");
    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp), route).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test('every link on every route leads to a page', async ({ page }) => {
  const links = new Set<string>();
  for (const route of [...ROUTES, '/spotify/callback']) {
    await page.goto(route, { waitUntil: 'load' });
    for (const href of await page.locator('a[href]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))) {
      const url = new URL(href);
      if (url.origin === new URL(page.url()).origin && !url.pathname.startsWith('/api/')) links.add(url.pathname);
    }
  }
  const broken: string[] = [];
  for (const path of links) {
    const response = await page.request.get(path);
    if (response.status() !== 200) broken.push(`${path} ${response.status()}`);
  }
  expect(broken).toEqual([]);
});

test('the Spotify callback starts a login only when asked, and as a page load', async ({ page }) => {
  const calls: boolean[] = [];
  // Any request to the login route, a prefetch with ?_rsc= included.
  await page.route(/\/api\/spotify\/login(\?|$)/, (route) => {
    calls.push(route.request().isNavigationRequest());
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'login started' });
  });
  const errors: string[] = [];
  // Vercel Analytics' script exists only on Vercel, so its 404 here is not counted.
  page.on('console', (m) => { if (m.type() === 'error' && !`${m.location().url} ${m.text()}`.includes('/_vercel/insights/')) errors.push(m.text()); });
  await page.goto('/spotify/callback?error=access_denied', { waitUntil: 'networkidle' });
  await expect(page.getByText('You cancelled the Spotify login.')).toBeVisible();
  // Next prefetches its own links once they show, which here would start a login nobody asked for.
  expect(calls).toEqual([]);
  await page.getByRole('link', { name: 'Try again' }).click();
  await expect(page.locator('body')).toHaveText('login started');
  expect(calls).toEqual([true]);
  expect(errors).toEqual([]);
});

test('the face detector loads from the app itself and runs under the policy', async ({ page }) => {
  const origins = new Set<string>();
  page.on('request', (request) => origins.add(new URL(request.url()).origin));

  await page.goto('/session');
  await page.getByRole('button', { name: /start session/i }).first().click();
  await expect(page.getByText(/no face detected/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/face detector failed to load/i)).toHaveCount(0);
  expect([...origins]).toEqual([new URL(page.url()).origin]);
});

test('an uploaded punishment video plays from IndexedDB', async ({ page }) => {
  await page.goto('/session');
  await page.evaluate(async () => {
    const id = 'custom_e2e';
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('sahurlock', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('videos');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('videos', 'readwrite');
        tx.objectStore('videos').put(new Blob(['x'], { type: 'video/mp4' }), id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
    localStorage.setItem('sahurlock.custom_video', JSON.stringify({ id, name: 'e2e.mp4', size: 1, type: 'video/mp4', addedAt: new Date().toISOString() }));
    const settings = JSON.parse(localStorage.getItem('sahurlock.settings') ?? '{}');
    localStorage.setItem('sahurlock.settings', JSON.stringify({ ...settings, punishmentMedia: 'custom' }));
  });
  await page.reload();
  await expect(page.locator('video.hidden')).toHaveAttribute('src', /^blob:/);
});

test('a session scheduled after load notifies without a reload', async ({ page }) => {
  await page.addInitScript(() => {
    const raised: string[] = [];
    (window as unknown as { __notified: string[] }).__notified = raised;
    (window as unknown as { Notification: unknown }).Notification = class {
      static permission = 'granted';
      static requestPermission() { return Promise.resolve('granted'); }
      constructor(title: string) { raised.push(title); }
      close() {}
    };
  });
  await page.goto('/tasks');
  await page.evaluate(() => {
    const session = { id: 'e2e', label: 'Exam prep', scheduledAt: new Date(Date.now() + 2_000).toISOString(), durationMinutes: 25, fired: false };
    localStorage.setItem('sahurlock.schedule', JSON.stringify([session]));
    window.dispatchEvent(new Event('sahurlock:schedule-changed'));
  });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __notified: string[] }).__notified), { timeout: 10_000 })
    .toEqual(['Time to focus!']);
});
