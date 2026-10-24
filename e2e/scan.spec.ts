import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { devices, expect, test, type Page } from '@playwright/test';
import { buildPdf, jpegInfo } from '../src/lib/scan/pdf';
import { readZip } from '../src/lib/zip-read';
import { violations } from './axe';

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
  await expect(page.getByRole('status').filter({ hasText: 'Page 1:' })).toHaveText('Page 1: Found the page edges and straightened it.', { timeout: 30_000 });
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
  await expect(page.getByRole('status').filter({ hasText: 'Page 1:' })).toContainText('No page edge stood out', { timeout: 30_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Page 1:' })).toContainText(/Levelled the writing by (3\.[6-9]|4\.[0-4])°/);
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

test('a saved scan survives a reload and downloads from the library', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles([
    { name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) },
    { name: 'p2.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page, true) },
  ]);
  await expect(page.getByRole('button', { name: 'Download PDF (2 pages)' })).toBeEnabled({ timeout: 30_000 });
  await page.getByLabel('Title').fill('Week 4 lecture');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();

  await page.reload({ waitUntil: 'networkidle' });
  const saved = page.getByRole('region', { name: 'Saved scans' });
  await expect(saved.getByText('Week 4 lecture')).toBeVisible();
  await expect(saved.getByText(/2 pages/)).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), saved.getByRole('button', { name: 'Download Week 4 lecture as PDF' }).click()]);
  expect(download.suggestedFilename()).toBe('Week-4-lecture.pdf');
  expect((await readFile(await download.path())).toString('latin1')).toContain('/Count 2');
});

test('deleting a saved scan asks first', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) });
  await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Save to this device' }).click();
  const saved = page.getByRole('region', { name: 'Saved scans' });
  const title = await saved.locator('li p').first().innerText();

  await saved.getByRole('button', { name: `Delete ${title}` }).click();
  await expect(saved.getByRole('button', { name: 'Keep' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(saved.getByText(title)).toBeVisible();
  await expect(saved.getByRole('button', { name: `Delete ${title}` })).toBeFocused();

  await page.keyboard.press('Enter');
  await saved.getByRole('group', { name: `Delete ${title}?` }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Saved scans' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Scan notes' })).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: `Deleted ${title}.` })).toBeAttached();
  // The pages still open were that scan, so saving them now makes a new one.
  await expect(page.getByRole('button', { name: 'Save to this device' })).toBeEnabled();
});

test('saving again after a change updates the saved scan instead of adding one', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) });
  await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled({ timeout: 30_000 });
  await page.getByLabel('Title').fill('Chem notes');
  await page.getByRole('button', { name: 'Save to this device' }).focus();
  await page.keyboard.press('Enter');
  // The button stays focused, so keyboard users keep their place.
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Saved Chem notes to this device.' })).toBeAttached();

  await page.getByLabel('Add page').setInputFiles({ name: 'p2.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page, true) });
  await expect(page.getByRole('button', { name: 'Download PDF (2 pages)' })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Saved the changes to Chem notes.' })).toBeAttached();

  const saved = page.getByRole('region', { name: 'Saved scans' });
  await expect(saved.getByRole('listitem')).toHaveCount(1);
  await expect(saved.getByText(/2 pages/)).toBeVisible();
});

test('removing every page and adding new ones saves a new scan', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) });
  await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled({ timeout: 30_000 });
  await page.getByLabel('Title').fill('Scan A');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();

  await page.getByRole('button', { name: 'Remove page 1' }).click();
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p2.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page, true) });
  await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByLabel('Title')).toHaveValue('');
  await page.getByLabel('Title').fill('Scan B');
  await page.getByRole('button', { name: 'Save to this device' }).click();

  const saved = page.getByRole('region', { name: 'Saved scans' });
  await expect(saved.getByRole('listitem')).toHaveCount(2);
  await expect(saved.getByText('Scan A')).toBeVisible();
  await expect(saved.getByText('Scan B')).toBeVisible();
});

test.describe('in San Diego in the evening', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('an untitled scan is named with the local date and time', async ({ page }) => {
    // 03:30 UTC on 24 October is 20:30 on 23 October in San Diego.
    await page.clock.setFixedTime(new Date('2026-10-24T03:30:00Z'));
    await page.goto('/scan', { waitUntil: 'networkidle' });
    await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) });
    await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByLabel('Title')).toHaveAttribute('placeholder', 'Notes 2026-10-23');
    await page.getByRole('button', { name: 'Save to this device' }).click();
    await expect(page.getByLabel('Title')).toHaveValue('Notes 2026-10-23 20:30');
    await expect(page.getByRole('region', { name: 'Saved scans' }).getByText('Notes 2026-10-23 20:30')).toBeVisible();
  });
});

test('a browser that is out of room says so next to the Save button', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  // Shrink this origin's real storage quota, so the save fails the way it would on a full device.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(page.url()).origin, quotaSize: 1024 });
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) });
  await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Save to this device' }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'out of room' });
  await expect(alert).toBeVisible();
  // It sits right under the Title and Save row.
  const row = await page.getByRole('button', { name: 'Save to this device' }).boundingBox();
  const box = await alert.boundingBox();
  expect(box!.y - (row!.y + row!.height)).toBeLessThan(40);
  await expect(page.getByRole('button', { name: 'Save to this device' })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Saved scans' })).toHaveCount(0);
});

test('with only the library on screen, downloads still offer a paper size', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) });
  await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled({ timeout: 30_000 });
  await page.getByLabel('Title').fill('Bio');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: 'Start over' }).click();

  const saved = page.getByRole('region', { name: 'Saved scans' });
  // Letter is preselected in the test browser's en-US locale, so pick A4.
  await saved.getByLabel('Paper').selectOption('a4');
  const [download] = await Promise.all([page.waitForEvent('download'), saved.getByRole('button', { name: 'Download Bio as PDF' }).click()]);
  expect((await readFile(await download.path())).toString('latin1')).toContain('/MediaBox [0 0 595.28 841.89]');
});

for (const theme of ['light', 'dark'] as const) {
  test(`the saved scans list passes WCAG 2.1 AA checks in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('sahurlock-theme', t), theme);
    await page.goto('/scan', { waitUntil: 'networkidle' });
    await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) });
    await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled({ timeout: 30_000 });
    await page.getByLabel('Title').fill('Physics');
    // Filed under a course, so the grouped list is what gets checked.
    await page.getByLabel('Course').fill('PHYS 2A');
    await page.getByRole('button', { name: 'Save to this device' }).click();
    const saved = page.getByRole('region', { name: 'Saved scans' });
    await expect(saved).toBeVisible();
    expect(await violations(page)).toEqual([]);

    await saved.getByRole('button', { name: 'Delete Physics' }).click();
    await expect(saved.getByRole('group', { name: 'Delete Physics?' })).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });
}

test('a saved scan opens again to rename, file under a course and reorder', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles([
    { name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) },
    { name: 'p2.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page, true) },
  ]);
  await expect(page.getByRole('button', { name: 'Download PDF (2 pages)' })).toBeEnabled({ timeout: 30_000 });
  const widthOf = async (n: number) => {
    await page.getByRole('button', { name: `Page ${n}`, exact: true }).click();
    return Number((await page.getByText(/^Cleaned, \d+ × \d+ px$/).innerText()).match(/(\d+) ×/)![1]);
  };
  const [first, second] = [await widthOf(1), await widthOf(2)];
  expect(first).not.toBe(second);
  await page.getByLabel('Title').fill('Lecture 5');
  await page.getByLabel('Course').fill('CSE 12');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: 'Start over' }).click();

  const saved = page.getByRole('region', { name: 'Saved scans' });
  await expect(saved.getByRole('heading', { level: 3, name: 'CSE 12' })).toBeVisible();
  await saved.getByRole('button', { name: 'Open Lecture 5' }).click();
  await expect(page.getByRole('heading', { name: 'Scan notes' })).toBeFocused();
  await expect(page.getByLabel('Title')).toHaveValue('Lecture 5');
  await expect(page.getByLabel('Course')).toHaveValue('CSE 12');
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();
  await expect(page.getByText('Saved scans keep only the cleaned page, not the photo.')).toBeVisible();

  // Opened pages are cleaned already, so the options leave them as they are: nothing is
  // sent to be cleaned, which would disable the download at once, and the image stays.
  const cleanedSrc = await page.getByRole('img', { name: 'The cleaned page' }).getAttribute('src');
  await page.getByLabel('Remove grid lines').check();
  expect(await page.getByRole('button', { name: 'Download PDF (2 pages)' }).isEnabled()).toBe(true);
  await expect(page.getByText('already cleaned, so these options apply to photos you add')).toBeVisible();
  await expect(page.getByRole('img', { name: 'The cleaned page' })).toHaveAttribute('src', cleanedSrc!);
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();

  // Refiling alone is a change worth saving.
  await page.getByLabel('Course').fill('MATH 20C');
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();

  await page.getByRole('button', { name: 'Page 2', exact: true }).click();
  await page.getByRole('button', { name: 'Move earlier' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Page 1:' })).toHaveText('Page 1: Opened from Saved scans.');
  await expect(page.getByRole('button', { name: 'Move earlier' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move earlier' })).toBeFocused();

  await page.getByLabel('Title').fill('Lecture 5 annotated');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();
  await expect(saved.getByRole('listitem')).toHaveCount(1);
  await expect(saved.getByRole('heading', { level: 3, name: 'MATH 20C' })).toBeVisible();
  await expect(saved.getByRole('heading', { level: 3, name: 'CSE 12' })).toHaveCount(0);

  const [download] = await Promise.all([page.waitForEvent('download'), saved.getByRole('button', { name: 'Download Lecture 5 annotated as PDF' }).click()]);
  const pdf = (await readFile(await download.path())).toString('latin1');
  expect([...pdf.matchAll(/\/Subtype \/Image \/Width (\d+)/g)].map((m) => Number(m[1]))).toEqual([second, first]);
});

test('a photo added to an opened scan is cleaned on its own and saved with the rest', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles([
    { name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) },
    { name: 'p2.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page, true) },
  ]);
  await expect(page.getByRole('button', { name: 'Download PDF (2 pages)' })).toBeEnabled({ timeout: 30_000 });
  await page.getByLabel('Title').fill('Lab 3');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: 'Start over' }).click();

  const saved = page.getByRole('region', { name: 'Saved scans' });
  await saved.getByRole('button', { name: 'Open Lab 3' }).click();
  const strip = page.getByRole('list', { name: 'Pages' });
  const firstSrc = await strip.locator('img').first().getAttribute('src');
  await page.getByLabel('Add page').setInputFiles({ name: 'p3.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page, true) });
  const pdfButton = page.getByRole('button', { name: 'Download PDF (3 pages)' });
  await expect(pdfButton).toBeEnabled({ timeout: 30_000 });

  // An option change cleans the new photo again and leaves the opened pages alone.
  await page.getByLabel('Remove grid lines').check();
  expect(await pdfButton.isEnabled()).toBe(false);
  await expect(pdfButton).toBeEnabled({ timeout: 30_000 });
  await expect(strip.locator('img').first()).toHaveAttribute('src', firstSrc!);

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();
  await expect(saved.getByRole('listitem')).toHaveCount(1);
  await expect(saved.getByText(/3 pages/)).toBeVisible();
});

test('opening a saved scan over unsaved pages asks first', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) });
  await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled({ timeout: 30_000 });
  await page.getByLabel('Title').fill('Scan A');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: 'Start over' }).click();
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p2.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page, true) });
  await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled({ timeout: 30_000 });

  const saved = page.getByRole('region', { name: 'Saved scans' });
  await saved.getByRole('button', { name: 'Open Scan A' }).click();
  const confirm = saved.getByRole('group', { name: 'Open Scan A in place of the scan you are working on? Its changes are not saved.' });
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(saved.getByRole('button', { name: 'Open Scan A' })).toBeFocused();
  await expect(page.getByLabel('Title')).toHaveValue('');

  await saved.getByRole('button', { name: 'Open Scan A' }).click();
  await confirm.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Scan A');
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();
});

test('a replace confirm goes away once the work it warned about is saved', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) });
  await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled({ timeout: 30_000 });
  await page.getByLabel('Title').fill('Scan A');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: 'Start over' }).click();
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p2.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page, true) });
  await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled({ timeout: 30_000 });

  const saved = page.getByRole('region', { name: 'Saved scans' });
  await saved.getByRole('button', { name: 'Open Scan A' }).click();
  await expect(saved.getByRole('group', { name: /^Open Scan A in place/ })).toBeVisible();
  await page.getByLabel('Title').fill('Scan B');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await expect(saved.getByRole('group', { name: /^Open Scan A in place/ })).toHaveCount(0);

  // Nothing is left to lose, so Open goes straight through.
  await saved.getByRole('button', { name: 'Open Scan A' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Scan A');
});

test('a PDF still being read does not end up in a scan opened meanwhile', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) });
  await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled({ timeout: 30_000 });
  await page.getByLabel('Title').fill('Scan A');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: 'Start over' }).click();

  // Six pages at full size take a few seconds to read, which leaves time to open a scan.
  const photos = [];
  for (let i = 0; i < 6; i++) photos.push(new Uint8Array(await notebookPhoto(page, i % 2 === 1)));
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.from(buildPdf(photos)) });
  await expect(page.getByRole('status').filter({ hasText: 'Reading big.pdf' })).toBeVisible();

  // A PDF being read counts as unsaved work, so opening asks first.
  const saved = page.getByRole('region', { name: 'Saved scans' });
  await saved.getByRole('button', { name: 'Open Scan A' }).click();
  await saved.getByRole('group', { name: /^Open Scan A in place/ }).getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Scan A');

  // There is no sign when a dropped import finishes, so wait out the read and then
  // check that none of its pages arrived.
  await page.waitForTimeout(8_000);
  await expect(page.getByRole('list', { name: 'Pages' }).getByRole('button', { name: /^Page \d/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();
});

test('a save still running when another scan is opened leaves the opened scan alone', async ({ page }) => {
  // Lets the test hold a save open: while the flag is set, opening the scans database
  // answers 1.5 s late, so the save is still running when the next click lands.
  await page.addInitScript(() => {
    const flagged = window as unknown as { __slowScans?: boolean };
    const open = IDBFactory.prototype.open;
    const onsuccess = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!;
    IDBFactory.prototype.open = function (name: string, version?: number) {
      const request = open.call(this, name, version);
      if (name === 'sahurlock-scans' && flagged.__slowScans) {
        Object.defineProperty(request, 'onsuccess', {
          set(handler: (event: Event) => void) {
            onsuccess.set!.call(this, (event: Event) => setTimeout(() => handler.call(this, event), 1_500));
          },
        });
      }
      return request;
    };
  });
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) });
  await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled({ timeout: 30_000 });
  await page.getByLabel('Title').fill('Scan B');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: 'Start over' }).click();
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p2.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page, true) });
  await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled({ timeout: 30_000 });
  await page.getByLabel('Title').fill('Scan X');

  await page.evaluate(() => { (window as unknown as { __slowScans?: boolean }).__slowScans = true; });
  await page.getByRole('button', { name: 'Save to this device' }).click();
  const saved = page.getByRole('region', { name: 'Saved scans' });
  await saved.getByRole('button', { name: 'Open Scan B' }).click();
  await saved.getByRole('group', { name: /^Open Scan B in place/ }).getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Scan B');

  // Once Scan X's save lands, the editor still holds Scan B, unchanged and saved.
  await expect(saved.getByText('Scan X')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel('Title')).toHaveValue('Scan B');
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();
});

/** Put scans straight into IndexedDB, as an earlier version of the app would have saved them. */
async function seedScans(page: Page, version: number, scans: { id: string; title: string; sizes: [number, number][]; document?: unknown }[]) {
  await page.evaluate(async ({ version, scans }) => {
    const jpeg = (w: number, h: number) => new Promise<Blob>((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fbfaf5';
      ctx.fillRect(0, 0, w, h);
      canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9);
    });
    const records: Record<string, unknown>[] = [];
    for (const s of scans) {
      const pages: { jpeg: Blob; width: number; height: number }[] = [];
      for (const [width, height] of s.sizes) pages.push({ jpeg: await jpeg(width, height), width, height });
      records.push({ id: s.id, title: s.title, course: '', createdAt: new Date().toISOString(), pages, ...(s.document === undefined ? {} : { document: s.document }) });
    }
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('sahurlock-scans', version);
      open.onupgradeneeded = () => open.result.createObjectStore('scans', { keyPath: 'id' });
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('scans', 'readwrite');
        for (const r of records) tx.objectStore('scans').put(r);
        tx.oncomplete = () => { open.result.close(); resolve(); };
      };
    });
  }, { version, scans });
}

/** A saved scan as stored, with each page's image left out. */
async function readScan(page: Page, id: string) {
  return page.evaluate((id) => new Promise<{ title: string; pages: { width: number; height: number }[]; document: unknown }>((resolve, reject) => {
    const open = indexedDB.open('sahurlock-scans');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = open.result.transaction('scans').objectStore('scans').get(id);
      request.onsuccess = () => {
        open.result.close();
        const r = request.result;
        resolve({ ...r, pages: r.pages.map((p: { width: number; height: number }) => ({ width: p.width, height: p.height })) });
      };
    };
  }), id);
}

test('a scan saved before regions existed still opens and saves', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' });
  await seedScans(page, 1, [{ id: 'old', title: 'Old notes', sizes: [[400, 500]] }]);
  await page.goto('/scan', { waitUntil: 'networkidle' });
  const saved = page.getByRole('region', { name: 'Saved scans' });
  await saved.getByRole('button', { name: 'Open Old notes' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();
  await page.getByLabel('Title').fill('Old notes, renamed');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();

  const record = await readScan(page, 'old');
  expect(record.title).toBe('Old notes, renamed');
  expect(record.document).toEqual({ version: 1, pages: [{ width: 400, height: 500, regionsComplete: false, blocks: [] }] });
});

test('marked regions stay with their page when pages are reordered', async ({ page }) => {
  const block = { id: 'r1', kind: 'math', box: { x: 40, y: 50, width: 200, height: 60 }, content: 'F = ma', tokens: [], origin: { by: 'user' }, reviewed: true };
  await page.goto('/settings', { waitUntil: 'networkidle' });
  await seedScans(page, 2, [{
    id: 'lab', title: 'Lab', sizes: [[400, 500], [500, 400]],
    document: { version: 1, pages: [
      { width: 400, height: 500, regionsComplete: true, blocks: [block] },
      { width: 500, height: 400, regionsComplete: false, blocks: [] },
    ] },
  }]);
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByRole('region', { name: 'Saved scans' }).getByRole('button', { name: 'Open Lab' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();
  await page.getByRole('button', { name: 'Page 2', exact: true }).click();
  await page.getByRole('button', { name: 'Move earlier' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();

  const record = await readScan(page, 'lab');
  expect(record.pages).toEqual([{ width: 500, height: 400 }, { width: 400, height: 500 }]);
  expect(record.document).toEqual({ version: 1, pages: [
    { width: 500, height: 400, regionsComplete: false, blocks: [] },
    { width: 400, height: 500, regionsComplete: true, blocks: [block] },
  ] });
});

test('code from before regions cannot open the scans database and save over them', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.waitForFunction(async () => (await indexedDB.databases()).some((d) => d.name === 'sahurlock-scans' && d.version === 2));
  const outcome = await page.evaluate(() => new Promise<string>((resolve) => {
    const open = indexedDB.open('sahurlock-scans', 1);
    open.onsuccess = () => { open.result.close(); resolve('opened'); };
    open.onerror = () => resolve(open.error?.name ?? 'error');
  }));
  expect(outcome).toBe('VersionError');
});

test('a scan whose labels do not line up with its pages opens without them and says so', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' });
  await seedScans(page, 2, [{
    id: 'odd', title: 'Odd', sizes: [[400, 500], [500, 400]],
    document: { version: 1, pages: [{ width: 400, height: 500, regionsComplete: true, blocks: [] }] },
  }]);
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByRole('region', { name: 'Saved scans' }).getByRole('button', { name: 'Open Odd' }).click();
  await expect(page.getByRole('status').filter({ hasText: "This scan's marked regions could not be read" })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Pages' }).getByRole('button', { name: /^Page \d/ })).toHaveCount(2);
});

/** One cleaned page in the editor, and the dialog it opens in. */
async function openEditor(page: Page) {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) });
  await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Mark regions on page 1' }).click();
  const editor = page.getByRole('dialog', { name: 'Mark regions on page 1 of 1' });
  await expect(editor.getByRole('heading', { name: 'Mark regions on page 1 of 1' })).toBeFocused();
  return editor;
}

test('a region can be added, moved, resized, marked as math and typed from the keyboard', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.getByRole('radio', { name: 'Math' }).check({ force: true });
  await editor.getByRole('button', { name: 'Add region' }).focus();
  await page.keyboard.press('Enter');

  const box = editor.getByRole('region', { name: 'Page' }).getByRole('button', { name: /^Region 1, math, / });
  await expect(box).toBeFocused();
  const before = await box.boundingBox();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(box).toBeFocused();
  const after = await box.boundingBox();
  expect(after!.y).toBeGreaterThan(before!.y);
  expect(after!.width).toBeGreaterThan(before!.width);
  await expect(editor.getByRole('status')).toContainText('Region 1, math,', { timeout: 2_000 });

  // Enter goes on to the region's kind, and Tab from there to what it says.
  await page.keyboard.press('Enter');
  await expect(editor.getByLabel('Kind')).toBeFocused();
  await editor.getByLabel('LaTeX').fill('F = ma');
  await expect(editor.getByRole('list', { name: 'Regions on this page' }).getByRole('button')).toContainText('F = ma');
  await expect(editor.getByText('1 region: 1 math.')).toBeVisible();

  // Something is typed, so deleting asks first, with focus on Keep.
  await box.focus();
  await page.keyboard.press('Delete');
  await expect(editor.getByRole('button', { name: 'Keep' })).toBeFocused();
  await editor.getByRole('group', { name: /^Delete region 1\?/ }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Add region' })).toBeFocused();
  await expect(editor.getByText('No regions yet.')).toBeVisible();

  await editor.getByRole('button', { name: 'Done' }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark regions on page 1' })).toBeFocused();
});

test('Escape closes the delete confirm before it closes the editor', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.getByRole('button', { name: 'Add region' }).click();
  await editor.getByLabel('What it says').fill('Kinematics');
  await editor.getByRole('button', { name: 'Delete region' }).click();
  await expect(editor.getByRole('button', { name: 'Keep' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Delete region' })).toBeFocused();
  await expect(editor.getByText('1 region: 1 text.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
});

test('switching a region to a kind kept as an image and back keeps what was typed', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.getByRole('button', { name: 'Add region' }).click();
  await editor.getByLabel('What it says').fill('Lecture 5');
  await editor.getByLabel('Kind').selectOption('diagram');
  await expect(editor.getByText('Kept as an image. Only its box and kind are saved.')).toBeVisible();
  await editor.getByLabel('Kind').selectOption('heading');
  await expect(editor.getByLabel('What it says')).toHaveValue('Lecture 5');
  // The region itself has the text again, not just the field.
  await expect(editor.getByRole('list', { name: 'Regions on this page' }).getByRole('button')).toContainText('Lecture 5');
});

test('marked regions are saved with the scan, come back after a reload, and alone make it unsaved', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.getByRole('button', { name: 'Add region' }).click();
  await editor.getByLabel('What it says').fill('Kinematics');
  await editor.getByRole('checkbox', { name: 'Every region on this page is marked' }).check();
  await editor.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Page 1, 1 region, every region marked' })).toBeVisible();
  await page.getByLabel('Title').fill('Physics 1');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();

  // A change to labels alone is a change worth saving.
  await page.getByRole('button', { name: 'Mark regions on page 1' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Move down' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('region', { name: 'Saved scans' }).getByRole('button', { name: 'Open Physics 1' }).click();
  await page.getByRole('button', { name: 'Mark regions on page 1' }).click();
  const reopened = page.getByRole('dialog');
  await expect(reopened.getByRole('list', { name: 'Regions on this page' }).getByRole('button')).toContainText('Kinematics');
  await expect(reopened.getByRole('checkbox', { name: 'Every region on this page is marked' })).toBeChecked();
});

test('the region editor fits a 320 px wide screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const editor = await openEditor(page);
  await editor.getByRole('button', { name: 'Add region' }).click();
  const overflow = await editor.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(editor.getByRole('button', { name: 'Done' })).toBeInViewport();
});

for (const theme of ['light', 'dark'] as const) {
  test(`the region editor passes WCAG 2.2 AA checks in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('sahurlock-theme', t), theme);
    const editor = await openEditor(page);
    for (const kind of ['Text', 'Heading', 'Math', 'Table', 'Graph', 'Diagram']) {
      await editor.getByRole('radio', { name: kind }).check({ force: true });
      await editor.getByRole('button', { name: 'Add region' }).click();
    }
    await editor.getByRole('list', { name: 'Regions on this page' }).getByRole('button').first().click();
    await editor.getByLabel('What it says').fill('Kinematics');
    expect(await violations(page, ['wcag22aa'])).toEqual([]);
    await editor.getByRole('button', { name: 'Delete region' }).click();
    await expect(editor.getByRole('group', { name: /^Delete region 1\?/ })).toBeVisible();
    expect(await violations(page, ['wcag22aa'])).toEqual([]);
  });
}

/** The editor's page surface and its rectangle on screen. */
async function surfaceOf(editor: ReturnType<Page['getByRole']>) {
  const surface = editor.getByRole('region', { name: 'Page' }).locator('.region-surface');
  await surface.scrollIntoViewIfNeeded();
  return { surface, rect: (await surface.boundingBox())! };
}

test('a region can be drawn by dragging with a mouse', async ({ page }) => {
  const editor = await openEditor(page);
  const { rect } = await surfaceOf(editor);
  const at = (fx: number, fy: number) => [rect.x + rect.width * fx, rect.y + rect.height * fy] as const;
  await page.mouse.move(...at(0.2, 0.3));
  await page.mouse.down();
  await page.mouse.move(...at(0.5, 0.35), { steps: 5 });
  await page.mouse.move(...at(0.7, 0.4), { steps: 5 });
  await page.mouse.up();

  const box = editor.getByRole('region', { name: 'Page' }).getByRole('button', { name: /^Region 1, text, / });
  await expect(box).toBeFocused();
  const drawn = (await box.boundingBox())!;
  expect(Math.abs(drawn.x - at(0.2, 0.3)[0])).toBeLessThan(3);
  expect(Math.abs(drawn.y - at(0.2, 0.3)[1])).toBeLessThan(3);
  expect(Math.abs(drawn.x + drawn.width - at(0.7, 0.4)[0])).toBeLessThan(3);
  expect(Math.abs(drawn.y + drawn.height - at(0.7, 0.4)[1])).toBeLessThan(3);
});

test('a region can be drawn with two taps, and Escape drops a waiting corner first', async ({ page }) => {
  const editor = await openEditor(page);
  const { rect } = await surfaceOf(editor);
  await page.mouse.click(rect.x + rect.width * 0.1, rect.y + rect.height * 0.6);
  await expect(editor.getByRole('region', { name: 'Page' }).getByText('First corner placed. Tap the opposite corner.')).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Cancel corner' })).toBeVisible();
  expect(await violations(page, ['wcag22aa'])).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Cancel corner' })).toHaveCount(0);

  await page.mouse.click(rect.x + rect.width * 0.1, rect.y + rect.height * 0.6);
  await page.mouse.click(rect.x + rect.width * 0.9, rect.y + rect.height * 0.7);
  await expect(editor.getByText('1 region: 1 text.')).toBeVisible();
  await expect(editor.getByRole('region', { name: 'Page' }).getByRole('button', { name: 'Region 1, text, middle' })).toBeFocused();
});

test('tapping a region selects it, and a box too small to keep says so', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.getByRole('button', { name: 'Add region' }).click();
  await editor.getByRole('button', { name: 'Add region' }).click();
  const rows = editor.getByRole('list', { name: 'Regions on this page' }).getByRole('button');
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');

  // Region 1 is the first one Add region placed: 10% to 18% of the page height, 10% to 90% of its width.
  const { rect } = await surfaceOf(editor);
  await page.mouse.click(rect.x + rect.width * 0.5, rect.y + rect.height * 0.14);
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');
  // The tapped region takes focus, so the arrow keys work on it next.
  await expect(editor.getByRole('region', { name: 'Page' }).getByRole('button', { name: /^Region 1, / })).toBeFocused();

  await page.mouse.move(rect.x + rect.width * 0.5, rect.y + rect.height * 0.8);
  await page.mouse.down();
  // A long sliver one screen pixel tall is too thin at any display size.
  await page.mouse.move(rect.x + rect.width * 0.5 + 80, rect.y + rect.height * 0.8 + 1, { steps: 4 });
  await page.mouse.up();
  await expect(editor.getByRole('region', { name: 'Page' }).getByText('That box is too small to be a region. Make it larger.')).toBeVisible();
  await expect(rows).toHaveCount(2);
});

test('a region can be drawn with a pen', async ({ page }) => {
  const editor = await openEditor(page);
  const { rect } = await surfaceOf(editor);
  const cdp = await page.context().newCDPSession(page);
  const pen = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', fx: number, fy: number) =>
    cdp.send('Input.dispatchMouseEvent', { type, x: rect.x + rect.width * fx, y: rect.y + rect.height * fy, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'pen' });
  await pen('mousePressed', 0.2, 0.5);
  for (let i = 1; i <= 5; i++) await pen('mouseMoved', 0.2 + 0.1 * i, 0.5 + 0.02 * i);
  await pen('mouseReleased', 0.7, 0.6);
  await expect(editor.getByText('1 region: 1 text.')).toBeVisible();
});

test.describe('on a touch screen', () => {
  const { defaultBrowserType: _, ...pixel } = devices['Pixel 7'];
  test.use(pixel);

  test('a finger draws a region without scrolling the editor', async ({ page }) => {
    const editor = await openEditor(page);
    const { rect } = await surfaceOf(editor);
    const scroller = editor.locator('div.overflow-y-auto').first();
    const before = await scroller.evaluate((el) => el.scrollTop);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', fx: number, fy: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: rect.x + rect.width * fx, y: rect.y + rect.height * fy }] });
    await touch('touchStart', 0.2, 0.3);
    for (let i = 1; i <= 6; i++) await touch('touchMove', 0.2 + 0.08 * i, 0.3 + 0.03 * i);
    await touch('touchEnd', 0, 0);
    await expect(editor.getByText('1 region: 1 text.')).toBeVisible();
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(before);
  });
});

/** Two cleaned pages, with one text region marked on page 1. */
async function twoPagesWithARegion(page: Page) {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles([
    { name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) },
    { name: 'p2.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page, true) },
  ]);
  await expect(page.getByRole('button', { name: 'Download PDF (2 pages)' })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Page 1', exact: true }).click();
  await page.getByRole('button', { name: 'Mark regions on page 1' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add region' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
}

test('Start over asks first when marked regions are not saved, and not once they are', async ({ page }) => {
  await twoPagesWithARegion(page);
  await page.getByRole('button', { name: 'Start over' }).click();
  const confirm = page.getByRole('group', { name: 'Start over? The marked regions are not saved and will be lost.' });
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Start over' })).toBeFocused();
  await expect(page.getByRole('list', { name: 'Pages' }).getByRole('button', { name: /^Page \d/ })).toHaveCount(2);

  await page.getByRole('button', { name: 'Save to this device' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByLabel('Choose photos or a PDF')).toBeAttached();
});

test('Start over goes ahead after the confirm', async ({ page }) => {
  await twoPagesWithARegion(page);
  await page.getByRole('button', { name: 'Start over' }).click();
  await page.getByRole('group', { name: /^Start over\?/ }).getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByLabel('Choose photos or a PDF')).toBeAttached();
});

test('removing a page with marked regions asks first', async ({ page }) => {
  await twoPagesWithARegion(page);
  const strip = page.getByRole('list', { name: 'Pages' });
  await page.getByRole('button', { name: 'Remove page 1' }).click();
  const confirm = page.getByRole('group', { name: 'Remove page 1 and its marked region?' });
  await expect(confirm.getByRole('button', { name: 'Keep' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Remove page 1' })).toBeFocused();
  await expect(strip.getByRole('button', { name: /^Page \d/ })).toHaveCount(2);

  await page.getByRole('button', { name: 'Remove page 1' }).click();
  await confirm.getByRole('button', { name: 'Remove' }).click();
  await expect(strip.getByRole('button', { name: /^Page \d/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Remove page 1' })).toBeFocused();

  // A page with nothing marked goes at once, as before.
  await page.getByRole('button', { name: 'Remove page 1' }).click();
  await expect(page.getByLabel('Choose photos or a PDF')).toBeAttached();
});

test('leaving the page with unsaved marked regions asks the browser to warn', async ({ page }) => {
  await twoPagesWithARegion(page);
  const warned = new Promise<string>((resolve) => page.once('dialog', async (d) => { resolve(d.type()); await d.dismiss(); }));
  await page.close({ runBeforeUnload: true });
  expect(await warned).toBe('beforeunload');
});

test('labeled pages download as one dataset file, and nothing leaves the device', async ({ page }) => {
  const origins = new Set<string>();
  page.on('request', (r) => { if (!r.url().startsWith('blob:') && !r.url().startsWith('data:')) origins.add(new URL(r.url()).origin); });
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) });
  await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Mark regions on page 1' }).click();
  const editor = page.getByRole('dialog');
  await editor.getByRole('radio', { name: 'Math' }).check({ force: true });
  await editor.getByRole('button', { name: 'Add region' }).click();
  await editor.getByLabel('LaTeX').fill('F = ma');
  await editor.getByRole('checkbox', { name: 'Every region on this page is marked' }).check();
  await editor.getByRole('button', { name: 'Done' }).click();
  await page.getByLabel('Title').fill('Physics');
  await page.getByLabel('Course').fill('PHYS 2A');
  await page.getByRole('button', { name: 'Save to this device' }).click();

  // A second scan with nothing marked adds nothing.
  await page.getByRole('button', { name: 'Start over' }).click();
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p2.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page, true) });
  await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();

  const saved = page.getByRole('region', { name: 'Saved scans' });
  const [download] = await Promise.all([page.waitForEvent('download'), saved.getByRole('button', { name: 'Download labels (1 page)' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^sahurlock-labels-\d{4}-\d{2}-\d{2}\.zip$/);
  const path = await download.path();
  const files = readZip(new Uint8Array(await readFile(path)));
  expect(files.map((f) => f.name)).toEqual(['manifest.json', 'pages.jsonl', expect.stringMatching(/^images\/[0-9a-f]{64}\.jpg$/)]);

  const image = files[2];
  const hash = createHash('sha256').update(image.data).digest('hex');
  expect(image.name).toBe(`images/${hash}.jpg`);
  const lines = new TextDecoder().decode(files[1].data).trimEnd().split('\n').map((l) => JSON.parse(l));
  expect(lines).toHaveLength(1);
  const [line] = lines;
  expect(line).toMatchObject({ sha256: hash, course: 'PHYS 2A', position: 0, regionsComplete: true });
  expect(jpegInfo(image.data)).toMatchObject({ width: line.width, height: line.height });
  expect(line.blocks).toHaveLength(1);
  expect(line.blocks[0]).toMatchObject({ kind: 'math', content: 'F = ma', origin: { by: 'user' }, reviewed: true });
  const { x, y, width, height } = line.blocks[0].box;
  expect(x >= 0 && y >= 0 && x + width <= line.width && y + height <= line.height).toBe(true);

  await expect(page.getByRole('status').filter({ hasText: 'Downloaded labels for 1 page from 1 scan, 1 of them fully marked.' })).toBeAttached();
  if (spawnSync('python3', ['--version']).status === 0) {
    const check = spawnSync('python3', ['-I', '-m', 'zipfile', '-t', path], { encoding: 'utf8' });
    expect(check.status, check.stderr).toBe(0);
    // The training script reads what the app writes.
    const labels = spawnSync('python3', ['-I', 'training/prepare.py', 'check', path], { encoding: 'utf8' });
    expect(labels.status, labels.stderr).toBe(0);
    expect(labels.stdout).toContain('OK: 1 page, 1 fully marked');
  }
  expect([...origins]).toEqual([new URL(page.url()).origin]);
});

test('with no labels the dataset download is unavailable, and says why', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'p1.jpg', mimeType: 'image/jpeg', buffer: await notebookPhoto(page) });
  await expect(page.getByRole('button', { name: /^Download PDF$/ })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Save to this device' }).click();
  const saved = page.getByRole('region', { name: 'Saved scans' });
  await expect(saved.getByRole('button', { name: 'Download labels (0 pages)' })).toBeDisabled();
  await expect(saved.getByText('A page counts once it has a marked region and its scan is saved. Nothing is uploaded.')).toBeVisible();
});

test('a file that is not an image gets a clear message', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'notes.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('alert').filter({ hasText: 'could not be opened' })).toBeVisible({ timeout: 30_000 });
});
