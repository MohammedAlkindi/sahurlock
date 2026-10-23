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
