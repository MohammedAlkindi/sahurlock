import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { buildPdf } from '../src/lib/scan/pdf';
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

test('a file that is not an image gets a clear message', async ({ page }) => {
  await page.goto('/scan', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos or a PDF').setInputFiles({ name: 'notes.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('alert').filter({ hasText: 'could not be opened' })).toBeVisible({ timeout: 30_000 });
});
