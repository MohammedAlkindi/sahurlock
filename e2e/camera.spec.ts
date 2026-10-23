import { expect, test, type Page } from '@playwright/test';

/** Records every camera track the page opens, so tests can check it was stopped. */
async function captureCameraTracks(page: Page) {
  await page.addInitScript(() => {
    const tracks: MediaStreamTrack[] = [];
    (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks = tracks;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      tracks.push(...stream.getTracks());
      return stream;
    };
  });
}

const trackStates = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.map((t) => t.readyState),
  );

const feedIsLive = (page: Page) =>
  page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('section video');
    const stream = video?.srcObject;
    return stream instanceof MediaStream && stream.active;
  });

async function startSession(page: Page) {
  await page.goto('/session');
  await page.getByRole('button', { name: /start session/i }).first().click();
  await expect.poll(() => feedIsLive(page)).toBe(true);
}

test('leaving the session page turns the camera off', async ({ page }) => {
  await captureCameraTracks(page);
  await startSession(page);
  expect(await trackStates(page)).toEqual(['live']);

  await page.locator('a[href="/stats"]').first().click();
  await page.waitForURL('**/stats');
  await expect.poll(() => trackStates(page)).toEqual(['ended']);
});

test('hiding and showing the camera keeps the live feed', async ({ page }) => {
  await startSession(page);
  await page.keyboard.press('h');
  await expect(page.getByText('Camera hidden')).toBeVisible();
  await page.keyboard.press('h');
  await expect(page.getByText('Camera hidden')).toBeHidden();
  expect(await feedIsLive(page)).toBe(true);
});

test('a failed calibration keeps the feed, and Retry Calibration uses it', async ({ page }) => {
  await startSession(page);
  const retry = page.getByRole('button', { name: /retry calibration/i });
  await expect(retry).toBeVisible({ timeout: 90_000 });
  expect(await feedIsLive(page)).toBe(true);

  await retry.click();
  await expect(page.getByText(/calibrating/i).first()).toBeVisible();
  expect(await feedIsLive(page)).toBe(true);
});
