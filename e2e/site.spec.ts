import { expect, test } from '@playwright/test';
import { PAGES, SITE_IMAGE_VERSION, SITE_URL } from '../src/lib/site';

const PATHS = ['/', ...Object.keys(PAGES).map((id) => `/${id}`), '/privacy', '/terms'];

test('every page has one h1', async ({ page }) => {
  for (const path of [...PATHS, '/spotify/callback']) {
    await page.goto(path, { waitUntil: 'load' });
    await expect(page.locator('h1'), path).toHaveCount(1);
  }
});

test('every page has its own title, description and canonical link', async ({ page }) => {
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  for (const path of PATHS) {
    await page.goto(path, { waitUntil: 'load' });
    const head = await page.evaluate(() => ({
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '',
      image: document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '',
      card: document.querySelector('meta[name="twitter:card"]')?.getAttribute('content') ?? '',
    }));
    titles.add(head.title);
    descriptions.add(head.description);
    expect(head.canonical, path).toBe(path === '/' ? SITE_URL : `${SITE_URL}${path}`);
    expect(head.image, path).toBe(`${SITE_URL}/opengraph-image?v=${SITE_IMAGE_VERSION}`);
    expect(head.card, path).toBe('summary_large_image');
  }
  expect(titles.size).toBe(PATHS.length);
  expect(descriptions.size).toBe(PATHS.length);
});

test('the share image, robots.txt, sitemap and llms.txt are served', async ({ request }) => {
  const image = await request.get('/opengraph-image');
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toBe('image/png');

  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain('Allow: /');
  expect(robots).toContain('Disallow: /api/');
  expect(robots).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);

  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const path of PATHS) expect(sitemap).toContain(`<loc>${SITE_URL}${path === '/' ? '' : path}</loc>`);
  expect(sitemap).not.toContain('/spotify');

  const llms = await request.get('/llms.txt');
  expect(llms.headers()['content-type']).toContain('text/plain');
  const text = await llms.text();
  expect(text.startsWith('# SahurLock')).toBe(true);
  for (const id of Object.keys(PAGES)) expect(text).toContain(`${SITE_URL}/${id})`);
});

test('the home page describes the app to search engines', async ({ page }) => {
  await page.goto('/');
  const data = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? '{}');
  expect(data).toMatchObject({ '@type': 'WebApplication', name: 'SahurLock', url: SITE_URL, isAccessibleForFree: true });
});

test('the Spotify callback page is kept out of search', async ({ page }) => {
  await page.goto('/spotify/callback');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
});

test('pages outside the sitemap name the same share image', async ({ page }) => {
  for (const path of ['/spotify/callback', '/no-such-page']) {
    await page.goto(path);
    await expect(page.locator('meta[property="og:image"]'), path).toHaveAttribute('content', `${SITE_URL}/opengraph-image?v=${SITE_IMAGE_VERSION}`);
  }
});

test('a missing page answers 404 with a way back', async ({ page }) => {
  const response = await page.goto('/no-such-page');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This page does not exist');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await page.getByRole('link', { name: 'Scan' }).click();
  await expect(page).toHaveURL(/\/scan$/);
});

test('the home and document pages fit a phone screen without sideways scrolling', async ({ page }) => {
  // 320 px is the width WCAG's reflow rule tests at, the same as 1280 px at 400% zoom.
  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ['/', '/privacy', '/terms', '/no-such-page']) {
      await page.goto(path, { waitUntil: 'load' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${path} at ${width} px`).toBeLessThanOrEqual(0);
    }
  }
});

test('the footer shows the current year', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('footer')).toContainText(`© ${new Date().getFullYear()} Mohammed Alkindi`);
});
