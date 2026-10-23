import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const ROUTES = ['/', '/session', '/timer', '/stats', '/schedule', '/tasks', '/notes', '/flashcards', '/sounds', '/settings'];

async function violations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/**
 * A week of use: sessions across every score grade, tasks, notes, flashcards
 * of each difficulty and schedules, so the scan sees filled-in pages too.
 */
function seedWeekOfUse() {
  const day = 86_400_000;
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const config = {
    durationMinutes: 25, offscreenThresholdSec: 6, breakLimit: 3, breakDurationSec: 300,
    punishmentEnabled: true, punishmentMedia: '/media/sahur.mp4', pomodoroEnabled: true,
    phoneDetectionEnabled: false, tabSwitchViolationEnabled: false, keyboardShortcutsEnabled: true,
  };
  const scores = [96, 88, 77, 64, 45, 91, 70, 83];
  const history = scores.map((focusScore, i) => ({
    id: `s${i}`,
    config,
    stats: {
      startedAt: iso(now - i * day - 30 * 60_000),
      endedAt: iso(now - i * day),
      totalFocusedMs: Math.round(25 * 60_000 * (focusScore / 100)),
      violationCount: Math.round((100 - focusScore) / 15),
      longestDistractionMs: (100 - focusScore) * 1_000,
      breakUsed: 1,
      breakTimeUsedMs: 120_000,
      focusScore,
      taskTitle: i % 2 ? 'Problem set 4' : undefined,
      notes: i === 0 ? 'Good run.' : undefined,
      recoveryTimes: [3_000],
      focusTransitions: 2,
    },
  }));
  const set = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));
  set('sahurlock.history', history);
  set('sahurlock.aggregate', {
    sessions: history.length,
    totalFocusedMs: history.reduce((n, h) => n + h.stats.totalFocusedMs, 0),
    totalViolations: history.reduce((n, h) => n + h.stats.violationCount, 0),
    totalBreakTimeMs: history.length * 120_000,
    longestDistractionMs: 55_000,
    currentStreak: 8,
    longestStreak: 8,
    lastSessionDate: iso(now).slice(0, 10),
    totalFocusScore: scores.reduce((a, b) => a + b, 0),
  });
  set('sahurlock.goals', { dailyGoalMinutes: 60 });
  set('sahurlock.tasks', [
    { id: 't1', title: 'Problem set 4', createdAt: iso(now - day), sessionCount: 3, status: 'active' },
    { id: 't2', title: 'Read chapter 7', createdAt: iso(now - day), sessionCount: 0, status: 'active' },
    { id: 't3', title: 'Lab report', createdAt: iso(now - 3 * day), completedAt: iso(now - day), sessionCount: 2, status: 'done' },
  ]);
  set('sahurlock.notes', [
    { id: 'n1', title: 'Limits', body: 'Squeeze theorem.', createdAt: iso(now - day), updatedAt: iso(now - day) },
    { id: 'n2', title: 'Recursion', body: 'Base case first.', createdAt: iso(now), updatedAt: iso(now) },
  ]);
  const today = iso(now).slice(0, 10);
  set('sahurlock.flashcards', [1, 2, 3].map((difficulty) => ({
    id: `c${difficulty}`, front: `Question ${difficulty}`, back: `Answer ${difficulty}`, difficulty,
    interval: 1, easeFactor: 2.5, nextReview: today, reviewCount: difficulty, correctCount: 1,
  })));
  set('sahurlock.schedule', [
    { id: 'p1', label: 'Morning block', scheduledAt: iso(now + day), durationMinutes: 50, fired: false },
    { id: 'p2', label: 'Last night', scheduledAt: iso(now - day), durationMinutes: 25, fired: true },
  ]);
}

for (const theme of ['light', 'dark'] as const) for (const data of ['empty', 'a week of use'] as const) {
  test(`every route passes WCAG 2.1 AA checks in the ${theme} theme, ${data}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('sahurlock-theme', t), theme);
    if (data !== 'empty') await page.addInitScript(seedWeekOfUse);
    const found: Record<string, string[]> = {};
    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: 'networkidle' });
      await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
      const v = await violations(page);
      if (v.length) found[route] = v;
    }
    expect(found).toEqual({});
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
