import { expect, test } from '@playwright/test';

test('phone navigation leaves room for session controls and closes after navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/session');
  const setup = page.getByRole('heading', { name: 'Session Setup' });
  await expect(setup).toBeVisible();
  const start = page.getByRole('button', { name: 'Start Session', exact: true });
  expect((await start.boundingBox())!.width).toBeGreaterThan(250);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const menu = page.getByRole('dialog', { name: 'Navigation', exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole('link', { name: 'Scan', exact: true }).click();
  await expect(page).toHaveURL(/\/scan$/);
  await expect(menu).not.toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('the command palette offers every tool in the sidebar', async ({ page }) => {
  await page.goto('/tasks', { waitUntil: 'networkidle' });
  const sidebar = await page.getByRole('navigation', { name: 'Tools' }).getByRole('link').allInnerTexts();
  expect(sidebar.length).toBeGreaterThan(0);

  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const offered = await palette.getByRole('option').allInnerTexts();
  for (const label of sidebar) expect(offered.map((o) => o.trim())).toContain(label.trim());
});

test('the sidebar marks the current tool', async ({ page }) => {
  await page.goto('/schedule', { waitUntil: 'networkidle' });
  const current = page.getByRole('navigation', { name: 'Tools' }).locator('[aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText('Schedule');
});
