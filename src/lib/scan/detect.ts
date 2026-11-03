import type { BlockKind, Box } from '@/lib/scan/document';
import { readingOrder } from '@/lib/scan/reading-order';
import { clampBox, type PageSize } from '@/lib/scan/regions';

// The region finder: PP-DocLayout-S, a layout model trained on document pages, run on the device
// through the model host. It proposes regions, and the user checks them.

/** The finder's name in public/models/manifest.json, and in a suggested region's origin. */
export const LAYOUT_MODEL = 'layout-detector';

/** The finder takes the page stretched to this square. */
export const DETECT_SIDE = 480;

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/**
 * The finder's input from RGBA pixels of the page drawn at DETECT_SIDE x DETECT_SIDE: red, green
 * and blue planes one after another, each normalised the way the model was trained.
 */
export function detectorInput(rgba: Uint8ClampedArray): Float32Array<ArrayBuffer> {
  const plane = DETECT_SIDE * DETECT_SIDE;
  if (rgba.length !== plane * 4) throw new Error(`Expected ${DETECT_SIDE} x ${DETECT_SIDE} RGBA pixels.`);
  const out = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) out[c * plane + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  }
  return out;
}

/**
 * The finder's 23 classes, in its order, as SahurLock's kinds. Page numbers, equation numbers,
 * seals and the pictures in a printed header or footer are not regions worth marking.
 */
const KINDS: (BlockKind | null)[] = [
  'heading', // paragraph_title
  'diagram', // image
  'text', // text
  null, // number
  'text', // abstract
  'text', // content
  'text', // figure_title
  'math', // formula
  'table', // table
  'text', // table_title
  'text', // reference
  'heading', // doc_title
  'text', // footnote
  'text', // header
  'text', // algorithm
  'text', // footer
  null, // seal
  'text', // chart_title
  'graph', // chart
  null, // formula_number
  null, // header_image
  null, // footer_image
  'text', // aside_text
];

export interface Suggestion {
  kind: BlockKind;
  box: Box;
  score: number;
}

const area = (b: Box) => b.width * b.height;
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/**
 * Regions from the finder's rows of [class, score, x1, y1, x2, y2], in page pixels, in reading
 * order. Rows below `minScore` go. So does a box that is mostly inside a stronger one, or inside a
 * region already on the page: the inline formulas of a paragraph, or one picture found both as a
 * chart and as an image. A weaker box of the same kind around a stronger one goes too, so a
 * paragraph found whole and in halves is suggested once.
 */
export function suggestionsFrom(rows: Float32Array, count: number, page: PageSize, existing: Box[] = [], minScore = 0.5): Suggestion[] {
  const found: Suggestion[] = [];
  for (let i = 0; i < Math.min(count, rows.length / 6); i++) {
    const [cls, score, x1, y1, x2, y2] = rows.subarray(i * 6, i * 6 + 6);
    const kind = KINDS[cls];
    if (!kind || !(score >= minScore) || !(x2 > x1) || !(y2 > y1)) continue;
    found.push({ kind, score, box: clampBox({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, page) });
  }
  const kept: Box[] = [...existing];
  const out: Suggestion[] = [];
  for (const s of found.sort((a, b) => b.score - a.score)) {
    if (kept.some((k) => overlap(s.box, k) >= 0.8 * area(s.box))) continue;
    if (out.some((o) => o.kind === s.kind && overlap(s.box, o.box) >= 0.8 * area(o.box))) continue;
    kept.push(s.box);
    out.push(s);
  }
  return readingOrder(out);
}
