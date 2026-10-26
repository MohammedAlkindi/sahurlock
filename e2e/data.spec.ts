import { expect, test, type Page } from '@playwright/test';

async function seedEverything(page: Page) {
  await page.evaluate(async () => {
    const put = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));
    put('sahurlock.notes', [{ id: 'n1', title: 'Limits', body: 'epsilon-delta' }]);
    put('sahurlock.flashcards', [{ id: 'c1', front: 'f', back: 'b' }]);
    put('sahurlock.tasks', [{ id: 't1', title: 'PA2' }]);
    put('sahurlock.schedule', []);
    localStorage.setItem('sahurlock.spotify.refresh_token', 'secret-token');
    localStorage.setItem('sahurlock-theme', 'dark');
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('sahurlock', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('videos');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('videos', 'readwrite');
        tx.objectStore('videos').put(new Blob(['x']), 'custom_e2e');
        tx.oncomplete = () => { open.result.close(); resolve(); };
      };
    });
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('sahurlock-scans', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('scans', { keyPath: 'id' });
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('scans', 'readwrite');
        const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
        tx.objectStore('scans').put({ id: 's1', title: 'Lecture', createdAt: new Date().toISOString(), pages: [{ jpeg, width: 1, height: 1 }] });
        tx.oncomplete = () => { open.result.close(); resolve(); };
      };
    });
  });
}

const leftovers = (page: Page) =>
  page.evaluate(async () => ({
    keys: Object.keys(localStorage).filter((k) => k.startsWith('sahurlock')),
    databases: (await indexedDB.databases()).map((d) => d.name),
  }));

test('export includes notes and flashcards but not the Spotify token', async ({ page }) => {
  await page.goto('/settings');
  await seedEverything(page);
  await page.getByRole('button', { name: 'Data', exact: true }).first().click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /export/i }).click(),
  ]);
  const text = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString());
  const data = JSON.parse(text);
  expect(data.notes[0].body).toBe('epsilon-delta');
  expect(data.flashcards).toHaveLength(1);
  expect(text).not.toContain('secret-token');
});

test('Clear everything leaves nothing behind', async ({ page, context }) => {
  await page.goto('/settings');
  await seedEverything(page);
  // The Spotify login's refresh token, in the httpOnly cookie the callback sets.
  await context.addCookies([{ name: 'spotify_refresh', value: 'rt', domain: 'localhost', path: '/api/spotify', httpOnly: true, sameSite: 'Strict' }]);
  await page.getByRole('button', { name: 'Data', exact: true }).first().click();
  await page.getByRole('button', { name: /^clear$/i }).click();
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: /clear everything/i }).click(),
  ]);
  // The settings page saves its defaults again on load; nothing the user created survives. The
  // Spotify disconnect is not waited for, so its pending mark goes once the server has answered.
  await expect.poll(async () => (await leftovers(page)).keys.filter((k) => k !== 'sahurlock.settings')).toEqual([]);
  const { databases } = await leftovers(page);
  expect(databases).not.toContain('sahurlock');
  expect(databases).not.toContain('sahurlock-scans');
  expect((await context.cookies('http://localhost:3200/api/spotify')).map((c) => c.name)).not.toContain('spotify_refresh');
});

test('a Spotify disconnect that could not reach the server is sent again once the browser is back online', async ({ page, context }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' });
  // As left by a disconnect made offline.
  await page.evaluate(() => localStorage.setItem('sahurlock.spotify.logout_pending', '1'));
  await context.setOffline(true);
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/spotify/logout') && r.method() === 'POST');
  await context.setOffline(false);
  await sent;
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sahurlock.spotify.logout_pending'))).toBeNull();
});
