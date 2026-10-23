import { devices, expect, test, type Page } from '@playwright/test';
import { violations } from './axe';

const ROUTES = ['/', '/session', '/timer', '/stats', '/schedule', '/tasks', '/notes', '/flashcards', '/scan', '/sounds', '/settings'];

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

/**
 * Form fields whose border is under 3:1 against the page behind them (WCAG
 * 1.4.11). axe does not check this. Borderless inline fields are skipped.
 */
async function weakFieldBorders(page: Page) {
  return page.evaluate(() => {
    type Rgba = { r: number; g: number; b: number; a: number };
    const parse = (css: string): Rgba => {
      const [r = 0, g = 0, b = 0, a = 1] = (css.match(/[\d.]+/g) ?? []).map(Number);
      return { r, g, b, a };
    };
    const over = (top: Rgba, below: Rgba): Rgba => ({
      r: top.r * top.a + below.r * (1 - top.a),
      g: top.g * top.a + below.g * (1 - top.a),
      b: top.b * top.a + below.b * (1 - top.a),
      a: 1,
    });
    const backdrop = (el: Element | null): Rgba => {
      const layers: Rgba[] = [];
      for (let e = el; e; e = e.parentElement) layers.unshift(parse(getComputedStyle(e).backgroundColor));
      return layers.reduce((acc, layer) => over(layer, acc), { r: 255, g: 255, b: 255, a: 1 });
    };
    const lum = ({ r, g, b }: Rgba) => {
      const ch = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    const contrast = (x: Rgba, y: Rgba) => {
      const [hi, lo] = [lum(x), lum(y)].sort((m, n) => n - m);
      return (hi + 0.05) / (lo + 0.05);
    };
    const weak: string[] = [];
    for (const el of Array.from(document.querySelectorAll('input, textarea, select'))) {
      const style = getComputedStyle(el);
      if (!el.getClientRects().length || style.visibility === 'hidden' || parseFloat(style.borderTopWidth) === 0) continue;
      const outside = backdrop(el.parentElement);
      const ratio = contrast(over(parse(style.borderTopColor), outside), outside);
      if (ratio < 3) weak.push(`${el.tagName.toLowerCase()} "${el.getAttribute('placeholder') ?? el.getAttribute('type') ?? ''}" ${ratio.toFixed(2)}:1`);
    }
    return weak;
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`form field borders stand out from the page in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('sahurlock-theme', t), theme);
    const found: Record<string, string[]> = {};
    let fields = 0;
    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: 'networkidle' });
      fields += await page.locator('input:visible, textarea:visible, select:visible').count();
      const weak = await weakFieldBorders(page);
      if (weak.length) found[route] = weak;
    }
    expect(fields).toBeGreaterThan(0);
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

test('row actions stay out of the way until hover on a desktop', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sahurlock.tasks', JSON.stringify([{ id: 't1', title: 'Read', createdAt: new Date().toISOString(), sessionCount: 0, status: 'active' }]));
  });
  await page.goto('/tasks', { waitUntil: 'networkidle' });
  const actions = page.getByRole('button', { name: 'Delete' }).first().locator('..');
  await expect(actions).toHaveCSS('opacity', '0');
  await page.getByText('Read').hover();
  await expect(actions).toHaveCSS('opacity', '1');
});

test.describe('on a touch screen', () => {
  const { defaultBrowserType: _, ...pixel } = devices['Pixel 7'];
  test.use(pixel);

  test('row actions are visible without hover', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('sahurlock.tasks', JSON.stringify([{ id: 't1', title: 'Read', createdAt: new Date().toISOString(), sessionCount: 0, status: 'active' }]));
      localStorage.setItem('sahurlock.flashcards', JSON.stringify([{ id: 'c1', front: 'Q', back: 'A', difficulty: 2, interval: 1, easeFactor: 2.5, nextReview: '2026-01-01', reviewCount: 0, correctCount: 0 }]));
    });
    const opacity = (name: string) => page.getByRole('button', { name }).first().evaluate((el) => {
      let o = 1;
      for (let e: Element | null = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
      return o;
    });
    await page.goto('/tasks', { waitUntil: 'networkidle' });
    expect(await opacity('Delete')).toBe(1);
    await page.goto('/flashcards', { waitUntil: 'networkidle' });
    expect(await opacity('Delete card')).toBe(1);
    expect(await opacity('Edit card')).toBe(1);
  });
});
