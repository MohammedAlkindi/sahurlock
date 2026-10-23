import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { buildPdf } from '../src/lib/scan/pdf';

/**
 * A JPEG of a ruled page with writing, tilted 4°, under light that fades to one
 * side: on a dark desk, or close up so the page fills the frame.
 */
async function notebookPhoto(page: Page, closeUp = false): Promise<Buffer> {
  const dataUrl = await page.evaluate((fill) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 1500;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = fill ? '#fbfaf5' : '#4a3b2f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(600, 750);
    ctx.rotate((4 * Math.PI) / 180);
    ctx.fillStyle = '#fbfaf5';
    ctx.fillRect(-420, -560, 840, 1120);
    for (let y = -480; y < 520; y += 48) {
      ctx.fillStyle = '#9fb4cf';
      ctx.fillRect(-420, y, 840, 3);
      ctx.fillStyle = '#1d1d2b';
      for (let x = -360; x < 300; x += 110) ctx.fillRect(x, y - 16, 70, 12);
      ctx.fillRect(-200, y - 16, 4, 30);
    }
    ctx.restore();
    const light = ctx.createLinearGradient(0, 0, canvas.width, 0);
    light.addColorStop(0, 'rgba(0,0,0,0.45)');
    light.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  }, closeUp);
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

test('a photographed page comes back cleaned, on the device', async ({ page }) => {
  const origins = new Set<string>();
  page.on('request', (r) => { if (!r.url().startsWith('blob:') && !r.url().startsWith('data:')) origins.add(new URL(r.url()).origin); });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __csp?: string[] }).__csp = [...((window as unknown as { __csp?: string[] }).__csp ?? []), e.violatedDirective];
    });
  });
  await page.goto('/scan', { waitUntil: 'networkidle' });

  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'notes.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) });

  // Straightening to the page edges also removes the tilt, so there is nothing left to level.
  await expect(page.getByRole('status')).toHaveText('Page 1: Found the page edges and straightened it.', { timeout: 30_000 });
  const cleaned = page.getByRole('img', { name: 'The cleaned page' });
  await expect(cleaned).toBeVisible();
  expect(await cleaned.evaluate((img: HTMLImageElement) => img.naturalWidth / img.naturalHeight)).toBeCloseTo(840 / 1120, 1);

  // No sliver of desk along the page edges.
  const darkestEdge = await cleaned.evaluate((img: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let min = 255;
    for (let x = 0; x < width; x++) for (const y of [0, height - 1]) min = Math.min(min, data[(y * width + x) * 4]);
    for (let y = 0; y < height; y++) for (const x of [0, width - 1]) min = Math.min(min, data[(y * width + x) * 4]);
    return min;
  });
  expect(darkestEdge).toBeGreaterThan(200);

  const download = page.getByRole('link', { name: 'Download this page as PNG' });
  await expect(download).toHaveAttribute('href', /^blob:/);
  await expect(download).toHaveAttribute('download', /^notes-\d{4}-\d{2}-\d{2}-page-1\.png$/);

  expect(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])).toEqual([]);
  expect([...origins]).toEqual([new URL(page.url()).origin]);
});

test('writing on a page that fills the photo is levelled', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'notes.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page, true) });
  await expect(page.getByRole('status')).toContainText('No page edge stood out', { timeout: 30_000 });
  await expect(page.getByRole('status')).toContainText(/Levelled the writing by (3\.[6-9]|4\.[0-4])°/);
});

test('changing an option cleans the page again', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'notes.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) });
  const cleaned = page.getByRole('img', { name: 'The cleaned page' });
  await expect(cleaned).toBeVisible({ timeout: 30_000 });
  const first = await cleaned.getAttribute('src');
  await page.getByLabel('Remove ruled lines').uncheck();
  await expect(cleaned).not.toHaveAttribute('src', first ?? '', { timeout: 30_000 });
});

test('several pages download as one PDF on the chosen paper', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) });
  await page.getByLabel('Add page').setInputFiles({ name: 'p2.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page, true) });
  const pdfButton = page.getByRole('button', { name: 'Download PDF (2 pages)' });
  await expect(pdfButton).toBeEnabled({ timeout: 30_000 });

  await page.getByLabel('Paper').selectOption('letter');
  const [download] = await Promise.all([page.waitForEvent('download'), pdfButton.click()]);
  expect(download.suggestedFilename()).toMatch(/^notes-\d{4}-\d{2}-\d{2}\.pdf$/);
  const pdf = (await readFile(await download.path())).toString('latin1');
  expect(pdf.startsWith('%PDF-1.4')).toBe(true);
  expect(pdf).toContain('/Count 2');
  expect(pdf.match(/\/MediaBox \[0 0 612 792\]/g)).toHaveLength(2);
  expect(pdf.match(/\/Filter \/DCTDecode/g)).toHaveLength(2);
});

test('a page can be removed', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles([
    { name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) },
    { name: 'p2.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page, true) },
  ]);
  await expect(page.getByRole('button', { name: 'Download PDF (2 pages)' })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Remove page 2' }).click();
  await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled();
  await expect(page.getByRole('list', { name: 'Pages' }).getByRole('button', { name: /^Page \d/ })).toHaveCount(1);
});

test('each page of a PDF becomes a page to clean', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  const pdf = buildPdf([new Uint8Array(await notebookPhoto(page)), new Uint8Array(await notebookPhoto(page, true))]);
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'lecture.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) });

  await expect(page.getByRole('button', { name: 'Download PDF (2 pages)' })).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByRole('list', { name: 'Pages' }).getByRole('button', { name: /^Page \d/ })).toHaveCount(2);
  await expect(page.getByRole('status').filter({ hasText: 'Page 1:' })).toContainText('Found the page edges');
  expect(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])).toEqual([]);
});

test('a PDF that cannot be read gets a clear message', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 not really') });
  await expect(page.getByRole('alert').filter({ hasText: 'could not be read as a PDF' })).toBeVisible({ timeout: 30_000 });
});

test('a file that is not an image gets a clear message', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'notes.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('alert').filter({ hasText: 'could not be opened' })).toBeVisible({ timeout: 30_000 });
});
