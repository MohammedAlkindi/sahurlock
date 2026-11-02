import type { Block, Box } from '@/lib/scan/document';
import { PAGE_JPEG_QUALITY } from '@/lib/scan/output';
import { readingOrder } from '@/lib/scan/reading-order';
import { KIND_LABELS } from '@/lib/scan/regions';
import { zipWriter } from '@/lib/zip';

// Scanned notes as Markdown that Obsidian, Notion, Joplin, Typora and Pandoc read: typed headings,
// text and $$ math in reading order, every region nothing has read kept as a picture, and each page
// not fully marked kept whole as well.

export interface NotesPage {
  jpeg: Blob;
  width: number;
  height: number;
  /** Set when the user says every region is marked. Until then the whole page goes in too, so nothing unmarked is lost. */
  regionsComplete: boolean;
  blocks: Block[];
}

/** A picture the Markdown links to: one region, or a whole page with none marked. */
export interface Crop {
  path: string;
  /** Index of the page it is cut from. */
  page: number;
  box: Box;
}

/** Cuts a box out of a page's JPEG. Browsers do this on a canvas, tests with a stand-in. */
export type Cropper = (jpeg: Blob, box: Box) => Promise<Blob>;

/**
 * Backslashes what would turn typed text into formatting, links, HTML or math: those characters
 * anywhere, and the quote, list, rule and table markers and list labels at the start of a line. A leading indent
 * is dropped, as it would start a code block.
 */
const escape = (text: string) =>
  text
    .replace(/[\\`*_[\]<$#^~]/g, '\\$&')
    .replace(/^[ \t]+/gm, '')
    .replace(/^([>+\-=|])/gm, '\\$1')
    // List labels Pandoc reads as list numbers: 1. 1) a) (a) i. (1)
    .replace(/^(\(?)(\d+|[A-Za-z]|[ivxlcdmIVXLCDM]+)([.)])(?=[ \t]|$)/gm, '$1$2\\$3');
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
/** Keeps each line break the user typed. A single newline is only a space in Markdown. */
const hardBreaks = (text: string) => text.replace(/([^\n])\n(?=[^\n])/g, '$1\\\n');

const MATH_DELIMITERS = [['$$', '$$'], ['$', '$'], ['\\[', '\\]'], ['\\(', '\\)']];

/** The LaTeX without the $, $$, \[ \] or \( \) it may be typed in, and with no blank line, which ends display math in Pandoc. */
function bareMath(latex: string): string {
  const pair = MATH_DELIMITERS.find(([open, close]) => latex.length >= open.length + close.length && latex.startsWith(open) && latex.endsWith(close));
  const inner = pair ? latex.slice(pair[0].length, latex.length - pair[1].length) : latex;
  return inner.trim().replace(/\n\s*\n/g, '\n');
}

/** The Markdown for these pages, and the pictures it links to under assets/. */
export function notesMarkdown(title: string, pages: Omit<NotesPage, 'jpeg'>[]): { markdown: string; crops: Crop[] } {
  const parts = [`# ${escape(oneLine(title)) || 'Notes'}`];
  const crops: Crop[] = [];
  const picture = (alt: string, crop: Crop) => {
    crops.push(crop);
    parts.push(`![${alt}](${crop.path})`);
  };
  pages.forEach((page, p) => {
    const n = p + 1;
    readingOrder(page.blocks).forEach((block) => {
      const content = block.content?.trim();
      const math = content && block.kind === 'math' ? bareMath(content) : '';
      if (content && block.kind === 'heading') parts.push(`## ${escape(oneLine(content))}`);
      else if (content && block.kind === 'text') parts.push(hardBreaks(escape(content)));
      else if (math) parts.push(`$$\n${math}\n$$`);
      // Numbered as the editor numbers it, in the order it was marked.
      else picture(`${KIND_LABELS[block.kind]} on page ${n}`, { path: `assets/page-${n}-region-${page.blocks.indexOf(block) + 1}.jpg`, page: p, box: block.box });
    });
    // Writing outside the marked regions is kept as the page itself.
    if (!page.regionsComplete || page.blocks.length === 0) {
      picture(`Page ${n}`, { path: `assets/page-${n}.jpg`, page: p, box: { x: 0, y: 0, width: page.width, height: page.height } });
    }
  });
  return { markdown: `${parts.join('\n\n')}\n`, crops };
}

/** A ZIP of notes.md and its pictures. A page with no regions goes in as it is, without cutting it again. */
export async function buildNotesZip(title: string, pages: NotesPage[], crop: Cropper, now: Date): Promise<Blob> {
  const { markdown, crops } = notesMarkdown(title, pages);
  const zip = zipWriter(now);
  zip.add('notes.md', new TextEncoder().encode(markdown));
  for (const c of crops) {
    const page = pages[c.page];
    const whole = c.box.x === 0 && c.box.y === 0 && c.box.width === page.width && c.box.height === page.height;
    const jpeg = whole ? page.jpeg : await crop(page.jpeg, c.box);
    zip.add(c.path, new Uint8Array(await jpeg.arrayBuffer()));
  }
  return zip.finish();
}

/** The browser's Cropper: draws the box on a canvas and saves it at the pages' own JPEG quality. */
export async function canvasCrop(jpeg: Blob, box: Box): Promise<Blob> {
  const bitmap = await createImageBitmap(jpeg, box.x, box.y, box.width, box.height);
  const canvas = new OffscreenCanvas(box.width, box.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D canvas in this browser.');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/jpeg', quality: PAGE_JPEG_QUALITY });
}
