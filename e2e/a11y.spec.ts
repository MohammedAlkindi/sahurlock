import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const ROUTES = ['/', '/session', '/timer', '/stats', '/schedule', '/tasks', '/notes', '/flashcards', '/sounds', '/settings'];

async function violations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

for (const theme of ['light', 'dark'] as const) {
  test(`every route passes WCAG 2.1 AA checks in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('sahurlock-theme', t), theme);
    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: 'networkidle' });
      await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
      expect(await violations(page), route).toEqual([]);
    }
  });
}

test('the command palette traps focus and gives it back on Escape', async ({ page }) => {
  await page.goto('/tasks', { waitUntil: 'networkidle' });
  const opener = page.getByPlaceholder(/add a task/i);
  await opener.focus();

  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByPlaceholder('Go to…')).toBeFocused();
  expect(await violations(page)).toEqual([]);

  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('single-key session shortcuts can be turned off', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Shortcuts' }).click();
  const toggle = page.getByRole('switch', { name: 'Single-key shortcuts' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sahurlock.settings') ?? '{}'));
  expect(saved.keyboardShortcutsEnabled).toBe(false);

  // H normally hides the camera (see camera.spec.ts). With shortcuts off it does nothing.
  await page.goto('/session');
  await page.getByRole('button', { name: /start session/i }).first().click();
  await expect(page.locator('section video')).toBeVisible();
  await page.keyboard.press('h');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(page.getByText('Camera hidden')).toHaveCount(0);
});
