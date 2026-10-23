import { expect, test, type Page } from '@playwright/test';
import { setFace, installFakeFace } from './fake-face';

// These tests put MediaPipe's canonical face in front of the real detector
// (see fake-face.ts), so a session can calibrate and run like it would for a
// person at the camera.

const lockOverlay = (page: Page) => page.getByRole('alert').filter({ hasText: 'LOCK IN' });

async function startFocusedSession(page: Page, settings: Record<string, unknown> = {}) {
  await installFakeFace(page);
  await page.addInitScript((s) => {
    localStorage.setItem('sahurlock.settings', JSON.stringify({ offscreenThresholdSec: 2, punishmentEnabled: false, ...s }));
  }, settings);
  await page.goto('/session');
  await page.getByRole('button', { name: /start session/i }).first().click();
  await expect(page.getByText('Focused').first()).toBeVisible({ timeout: 30_000 });
}

test('a face looking at the screen calibrates and counts as focused', async ({ page }) => {
  await startFocusedSession(page);
  await expect(lockOverlay(page)).toHaveCount(0);
});

test('turning the head 45° away locks the session', async ({ page }) => {
  await startFocusedSession(page);
  await setFace(page, { yaw: 45 });
  await expect(lockOverlay(page)).toBeVisible({ timeout: 15_000 });
});

test('looking away with the eyes alone locks the session', async ({ page }) => {
  await startFocusedSession(page);
  await setFace(page, { gazeX: 0.45 });
  await expect(lockOverlay(page)).toBeVisible({ timeout: 15_000 });
});

test('a glance of a few degrees does not', async ({ page }) => {
  await startFocusedSession(page);
  await setFace(page, { yaw: 8, pitch: -5 });
  await page.waitForTimeout(5_000);
  await expect(lockOverlay(page)).toHaveCount(0);
});

test('ending a session opens the summary as a dialog that holds and returns focus', async ({ page }) => {
  await startFocusedSession(page);
  await page.keyboard.press('e');
  const summary = page.getByRole('dialog', { name: /session complete/i });
  await expect(summary).toBeVisible();
  expect(await summary.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await summary.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(summary).toHaveCount(0);
});

test('a break with due flashcards opens them as a dialog that Escape closes', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sahurlock.flashcards', JSON.stringify([
      { id: 'c1', front: 'What is 2 + 2?', back: '4', difficulty: 1, interval: 1, easeFactor: 2.5, nextReview: '2026-01-01', reviewCount: 0, correctCount: 0 },
    ]));
  });
  await startFocusedSession(page);
  await page.keyboard.press('b');
  const cards = page.getByRole('dialog', { name: /break review/i });
  await expect(cards).toBeVisible();
  await expect(cards.getByText('What is 2 + 2?')).toBeVisible();
  expect(await cards.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(cards).toHaveCount(0);
});
