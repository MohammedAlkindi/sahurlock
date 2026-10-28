import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { tinyAddModel } from '../src/lib/model-host/test-model';
import { violations } from './axe';

// The production manifest pins no model yet, so these tests route in a tiny one, y = x + bias,
// with no test hook in the app.

const runtimePin: { version: string; entry: { file: string }; glue: { file: string }; wasm: { file: string } } =
  JSON.parse(readFileSync(join(__dirname, '..', 'src', 'lib', 'model-host', 'runtime-pin.json'), 'utf8'));
const RUNTIME = `/vendor/onnxruntime-web/${runtimePin.version}/`;

const good = Buffer.from(tinyAddModel());
const sha256 = createHash('sha256').update(good).digest('hex');
const pin = { name: 'tiny-add', version: '1', url: `/models/tiny-add-${sha256.slice(0, 8)}.onnx`, sha256, size: good.length };

const READY = /^tiny-add is ready on this device \((CPU|GPU)\)\.$/;

/** Serves the test model's manifest entry and, at its address, the given bytes. */
async function routeModel(page: Page, bytes: Buffer) {
  await page.route('**/models/manifest.json', (route) => route.fulfill({ json: { schema: 1, models: [pin] } }));
  await page.route(`**${pin.url}`, (route) => route.fulfill({ contentType: 'application/octet-stream', body: bytes }));
}

async function openData(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Data', exact: true }).first().click();
}

test('shows no models and saves nothing while none are pinned', async ({ page }) => {
  await page.goto('/settings');
  // The block lists the manifest in a worker of its own, which closes once it has the answer.
  const listed = new Promise<void>((resolve) => page.once('worker', (w) => w.once('close', () => resolve())));
  await page.getByRole('button', { name: 'Data', exact: true }).first().click();
  await listed;
  // The answer is set before the worker closes. Two frames let React draw it.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByText('On-device models')).toHaveCount(0);
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
});

test('loads a pinned model from the app itself, then offline in a new worker', async ({ page, context, baseURL }) => {
  const requests: string[] = [];
  const failed: string[] = [];
  const errors: string[] = [];
  const workers: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('requestfailed', (r) => failed.push(`${new URL(r.url()).pathname} ${r.failure()?.errorText}`));
  // next start does not serve the Vercel analytics script, as in app.spec.ts.
  page.on('console', (m) => { if (m.type() === 'error' && !`${m.location().url} ${m.text()}`.includes('/_vercel/insights/')) errors.push(m.text()); });
  page.on('worker', (w) => workers.push(w.url()));
  await routeModel(page, good);

  await openData(page);
  await expect(page.getByText(`${pin.name} ${pin.version}`)).toBeVisible();
  await page.getByRole('button', { name: `Check ${pin.name}` }).click();
  await expect(page.getByRole('status').filter({ hasText: READY })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/, saved on this device\.$/)).toBeVisible();
  expect(await violations(page)).toEqual([]);

  // Playwright's routing turns off the HTTP cache, so fill it the way an unrouted visit does:
  // the worker's script and the two runtime scripts, each under its own cache headers.
  await page.unrouteAll({ behavior: 'wait' });
  const workerScript = workers.at(-1)?.split('#')[0] ?? '';
  expect(workerScript).not.toBe('');
  await page.evaluate((urls) => Promise.all(urls.map((url) => fetch(url))), [
    workerScript, RUNTIME + runtimePin.entry.file, RUNTIME + runtimePin.glue.file,
  ]);

  await context.setOffline(true);
  const offlineManifest = page.waitForEvent('requestfailed', (r) => r.url().endsWith('/models/manifest.json'));
  await page.getByRole('button', { name: `Check ${pin.name}` }).click();
  // The new worker really was offline, and found the manifest and the model on the device.
  expect((await offlineManifest).failure()?.errorText).toContain('ERR_INTERNET_DISCONNECTED');
  await expect(page.getByRole('status').filter({ hasText: READY })).toBeVisible({ timeout: 60_000 });

  // The model and the runtime's .wasm were each downloaded once, by the host, which checked them.
  // ONNX Runtime fetched no .wasm of its own, and the offline check found both on the device.
  expect(requests.filter((u) => u.endsWith(pin.url))).toHaveLength(1);
  expect(requests.filter((u) => u.endsWith(`/${runtimePin.wasm.file}`))).toHaveLength(1);
  // Only the offline manifest request failed among the app's own files.
  expect(failed.filter((f) => /^\/(models|vendor|_next)\//.test(f) && !f.startsWith('/models/manifest.json'))).toEqual([]);
  expect([...new Set(requests.filter((u) => /^https?:/.test(u)).map((u) => new URL(u).origin))]).toEqual([new URL(baseURL ?? '').origin]);
  expect(errors).toEqual([]);
});

test('refuses a model whose checksum does not match, before the runtime loads', async ({ page }) => {
  const runtimeRequests: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/vendor/onnxruntime-web/')) runtimeRequests.push(r.url()); });
  // The same size as the pinned file, so only the SHA-256 tells them apart.
  const swapped = Buffer.from(tinyAddModel({ producerVersion: '2' }));
  expect(swapped.length).toBe(pin.size);
  await routeModel(page, swapped);

  await openData(page);
  await page.getByRole('button', { name: `Check ${pin.name}` }).click();
  await expect(page.getByRole('status').filter({ hasText: 'tiny-add was refused: the file does not match its checksum.' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/, not saved on this device\.$/)).toBeVisible();
  expect(runtimeRequests).toEqual([]);
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
});
