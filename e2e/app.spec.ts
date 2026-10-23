import { expect, test } from '@playwright/test';

const ROUTES = ['/', '/session', '/timer', '/stats', '/schedule', '/tasks', '/notes', '/flashcards', '/scan', '/sounds', '/settings'];

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
