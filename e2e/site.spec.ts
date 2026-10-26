import { expect, test } from '@playwright/test';

const PATHS = ['/', '/session', '/tasks', '/stats', '/schedule', '/notes', '/flashcards', '/scan', '/timer', '/sounds', '/settings', '/privacy', '/terms'];

test('every page has one h1', async ({ page }) => {
  for (const path of [...PATHS, '/spotify/callback']) {
    await page.goto(path, { waitUntil: 'load' });
    await expect(page.locator('h1'), path).toHaveCount(1);
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
