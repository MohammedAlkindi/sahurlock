import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/** WCAG 2.1 A and AA violations on the page as it is now, one line each. `extraTags` adds rule sets such as 'wcag22aa'. */
export async function violations(page: Page, extraTags: string[] = []) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', ...extraTags])
    .analyze();
  return violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}
