import { expect, test } from '@playwright/test';

const ROUTES = ['/', '/session', '/timer', '/stats', '/schedule', '/tasks', '/notes', '/flashcards', '/scan', '/sounds', '/settings'];
const LISTS = ['history', 'tasks', 'notes', 'flashcards', 'schedule', 'templates'];

// Stored data that parses as JSON but is not what the app wrote: an older
// version, a hand edit, or a write cut short.
const MALFORMED: Record<string, Record<string, string>> = {
  'the wrong container': {
    ...Object.fromEntries(LISTS.map((k) => [`sahurlock.${k}`, '{"a":1}'])),
    'sahurlock.aggregate': '[]',
    'sahurlock.goals': '[]',
    'sahurlock.settings': '[1]',
  },
  'null items': Object.fromEntries(LISTS.map((k) => [`sahurlock.${k}`, '[null]'])),
  'missing fields': {
    ...Object.fromEntries(LISTS.map((k) => [`sahurlock.${k}`, '[{"id":"x"}]'])),
    'sahurlock.aggregate': '{}',
    'sahurlock.settings': '{"durationMinutes":"25"}',
  },
};

for (const [name, seed] of Object.entries(MALFORMED)) {
  test(`every route still loads when storage holds ${name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, seed);
    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: 'networkidle' });
      await expect(page.getByText(/application error/i), route).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

test('a bad record does not hide the good ones next to it', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sahurlock.tasks', JSON.stringify([null, { id: 't1', title: 'Keep me' }, { id: 't2' }]));
  });
  await page.goto('/tasks', { waitUntil: 'networkidle' });
  await expect(page.getByText('Keep me')).toBeVisible();
});
