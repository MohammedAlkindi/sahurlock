import { type Block, BLOCK_KINDS, type BlockKind, DOCUMENT_VERSION } from '@/lib/scan/document';
import type { SavedScan } from '@/lib/scan/library';
import { CLEAN_MAX_SIDE, PAGE_JPEG_QUALITY } from '@/lib/scan/output';
import { jpegInfo } from '@/lib/scan/pdf';
import { localDate } from '@/lib/utils';
import { crc32, zipWriter } from '@/lib/zip';

/**
 * The labels download: every saved page with marked regions, as one ZIP for
 * training SahurLock's own models. Nothing is uploaded, the user downloads it.
 *
 *   manifest.json        what the file is, its versions and counts
 *   pages.jsonl          one line per page: image, size, scan, course, regions
 *   images/<sha256>.jpg  each page's stored JPEG, unchanged, named by its hash
 *
 * Boxes are in the JPEG's pixels from its top-left corner, which is COCO's
 * bbox convention. training/ builds the detector's COCO files and the
 * held-out split from pages.jsonl, so those rules live in one place.
 */

export const LABELS_FORMAT_VERSION = 1;

/** A region that counts as a label: one the user made or checked. A model's unchecked guess is not one. */
const isLabel = (b: Block) => b.origin.by === 'user' || b.reviewed;

export interface LabeledPage {
  scan: SavedScan;
  /** The page's place in its scan, from 0. */
  position: number;
  jpeg: Blob;
  width: number;
  height: number;
  regionsComplete: boolean;
  blocks: Block[];
}

/**
 * The pages a labels download includes: those marked complete or with at
 * least one label. Scans whose labels could not be read are left out. Give
 * scans newest first, as the library lists them, so that of two copies of one
 * page image the newest is kept.
 */
export function labeledPages(scans: SavedScan[]): LabeledPage[] {
  const pages: LabeledPage[] = [];
  for (const scan of scans) {
    if (scan.labelsUnreadable) continue;
    scan.pages.forEach((p, position) => {
      const { regionsComplete, blocks } = scan.document.pages[position];
      const labels = blocks.filter(isLabel);
      if (regionsComplete || labels.length > 0) {
        pages.push({ scan, position, jpeg: p.jpeg, width: p.width, height: p.height, regionsComplete, blocks: labels });
      }
    });
  }
  return pages;
}

export const labelsFileName = (now: Date) => `sahurlock-labels-${localDate(now)}.zip`;

export class LabelsTooLargeError extends Error {
  constructor() {
    super('The labeled pages are too large for one download.');
  }
}

export interface LabelsExport {
  zip: Blob;
  pages: number;
  scans: number;
  completePages: number;
  skipped: { duplicateImage: number; sizeMismatch: number; unreadableLabels: number };
}

const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');

// Keys are written in a fixed order, so the same labels always give the same file.
const blockJson = (b: Block) => ({
  id: b.id,
  kind: b.kind,
  box: { x: b.box.x, y: b.box.y, width: b.box.width, height: b.box.height },
  content: b.content,
  tokens: b.tokens.map((t) => ({ text: t.text, confidence: t.confidence, alternatives: t.alternatives.map((a) => ({ text: a.text, confidence: a.confidence })) })),
  origin: b.origin.by === 'user' ? { by: 'user' } : { by: 'model', model: b.origin.model, version: b.origin.version },
  reviewed: b.reviewed,
});

/**
 * Build the labels download. Pages are read one at a time, to hash the image
 * and check its size against its frame header, and only a reference to each
 * stored JPEG goes into the ZIP, so memory holds about one page at a time.
 */
export async function buildLabelsZip(scans: SavedScan[], now: Date): Promise<LabelsExport> {
  const candidates = labeledPages(scans);
  // Checked before anything is read: a ZIP without ZIP64 holds under 4 GiB and 65,535 files.
  const total = candidates.reduce((n, p) => n + p.jpeg.size, 0);
  if (candidates.length + 2 >= 0xffff || total >= 0xf0000000) throw new LabelsTooLargeError();

  const skipped = { duplicateImage: 0, sizeMismatch: 0, unreadableLabels: scans.filter((s) => s.labelsUnreadable).length };
  const seen = new Set<string>();
  const kept: { sha: string; crc: number; page: LabeledPage }[] = [];
  for (const page of candidates) {
    const bytes = new Uint8Array(await page.jpeg.arrayBuffer());
    let size: { width: number; height: number } | null = null;
    try { size = jpegInfo(bytes); } catch { size = null; }
    // Boxes are in the stored size, so an image of another size would put them in the wrong place.
    if (!size || size.width !== page.width || size.height !== page.height) {
      skipped.sizeMismatch++;
      continue;
    }
    const sha = hex(await crypto.subtle.digest('SHA-256', bytes));
    if (seen.has(sha)) {
      skipped.duplicateImage++;
      continue;
    }
    seen.add(sha);
    kept.push({ sha, crc: crc32(bytes), page });
  }
  kept.sort((a, b) => (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0));

  const lines = kept.map(({ sha, page }) => JSON.stringify({
    image: `images/${sha}.jpg`,
    sha256: sha,
    width: page.width,
    height: page.height,
    scan: page.scan.id,
    position: page.position,
    course: page.scan.course,
    savedAt: page.scan.createdAt,
    regionsComplete: page.regionsComplete,
    blocks: page.blocks.map(blockJson),
  }));

  const blocks = kept.flatMap(({ page }) => page.blocks);
  const byKind = Object.fromEntries(BLOCK_KINDS.map((k) => [k, blocks.filter((b) => b.kind === k).length])) as Record<BlockKind, number>;
  const result = {
    pages: kept.length,
    scans: new Set(kept.map(({ page }) => page.scan.id)).size,
    completePages: kept.filter(({ page }) => page.regionsComplete).length,
    skipped,
  };
  const manifest = {
    format: 'sahurlock-labels',
    formatVersion: LABELS_FORMAT_VERSION,
    documentVersion: DOCUMENT_VERSION,
    exportedAt: now.toISOString(),
    kinds: BLOCK_KINDS,
    coordinates: { unit: 'px', origin: 'top-left', box: ['x', 'y', 'width', 'height'], space: 'stored JPEG' },
    image: { format: 'jpeg', quality: PAGE_JPEG_QUALITY, maxSide: CLEAN_MAX_SIDE },
    counts: {
      scans: result.scans,
      pages: result.pages,
      regionsCompletePages: result.completePages,
      blocks: byKind,
      blocksWithContent: blocks.filter((b) => b.content !== null).length,
      skipped,
    },
  };

  const encoder = new TextEncoder();
  const zip = zipWriter(now);
  zip.add('manifest.json', encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`));
  zip.add('pages.jsonl', encoder.encode(lines.map((l) => `${l}\n`).join('')));
  for (const { sha, crc, page } of kept) zip.addBlob(`images/${sha}.jpg`, page.jpeg, crc);
  return { zip: zip.finish(), ...result };
}
