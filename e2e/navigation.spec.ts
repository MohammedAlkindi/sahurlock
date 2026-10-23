import { expect, test } from '@playwright/test';

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
