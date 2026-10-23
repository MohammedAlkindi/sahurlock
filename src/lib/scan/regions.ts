import type { Block, BlockKind, Box } from '@/lib/scan/document';

/** Region geometry for the editor, in cleaned-page pixels. Pure, so it is unit tested. */

export interface PageSize {
  width: number;
  height: number;
}

export const KIND_LABELS: Record<BlockKind, string> = {
  text: 'Text', heading: 'Heading', math: 'Math', table: 'Table', graph: 'Graph', diagram: 'Diagram',
};

const longest = (page: PageSize) => Math.max(page.width, page.height);

/** The smallest a region may be on either side: half a percent of the page, at least 8 px. */
export const minSide = (page: PageSize) => Math.max(8, Math.round(0.005 * longest(page)));

/** How far one arrow key press moves or resizes: 1% of the page, at least 1 px. */
export const stepSize = (page: PageSize) => Math.max(1, Math.round(0.01 * longest(page)));

/** The box in whole pixels, at least the minimum size, and inside the page. */
export function clampBox(box: Box, page: PageSize): Box {
  const min = minSide(page);
  const width = Math.min(page.width, Math.max(min, Math.round(box.width)));
  const height = Math.min(page.height, Math.max(min, Math.round(box.height)));
  return {
    x: Math.min(page.width - width, Math.max(0, Math.round(box.x))),
    y: Math.min(page.height - height, Math.max(0, Math.round(box.y))),
    width,
    height,
  };
}

export const moveBox = (box: Box, dx: number, dy: number, page: PageSize) =>
  clampBox({ ...box, x: box.x + dx, y: box.y + dy }, page);

/** Grow or shrink from the bottom-right corner, never below the minimum or past the page edge. */
export function resizeBox(box: Box, dw: number, dh: number, page: PageSize): Box {
  const min = minSide(page);
  return {
    ...box,
    width: Math.max(min, Math.min(page.width - box.x, box.width + dw)),
    height: Math.max(min, Math.min(page.height - box.y, box.height + dh)),
  };
}

/**
 * Where Add region puts a new box: just below the last region, with its left
 * edge and width, 8% of the page tall. The first one sits 10% from the top and
 * spans 80% of the width, where a page's first line of notes usually is.
 */
export function newBoxBelow(blocks: Block[], page: PageSize): Box {
  const height = 0.08 * page.height;
  const last = blocks.at(-1)?.box;
  if (!last) return clampBox({ x: 0.1 * page.width, y: 0.1 * page.height, width: 0.8 * page.width, height }, page);
  return clampBox({ x: last.x, y: last.y + last.height + 0.01 * page.height, width: last.width, height }, page);
}

/** Where a box's centre falls, in thirds of the page: "top left", "top", ..., "middle", ..., "bottom right". */
export function position(box: Box, page: PageSize): string {
  const third = (centre: number, size: number) => Math.min(2, Math.floor((3 * centre) / size));
  const row = ['top', 'middle', 'bottom'][third(box.y + box.height / 2, page.height)];
  const col = ['left', 'centre', 'right'][third(box.x + box.width / 2, page.width)];
  if (col === 'centre') return row;
  return row === 'middle' ? col : `${row} ${col}`;
}

const PLURAL: Record<BlockKind, (n: number) => string> = {
  text: () => 'text', math: () => 'math',
  heading: (n) => (n === 1 ? 'heading' : 'headings'),
  table: (n) => (n === 1 ? 'table' : 'tables'),
  graph: (n) => (n === 1 ? 'graph' : 'graphs'),
  diagram: (n) => (n === 1 ? 'diagram' : 'diagrams'),
};

/** One line on what is marked, such as "5 regions: 3 text, 1 math, 1 graph." */
export function summary(blocks: Block[]): string {
  if (blocks.length === 0) return 'No regions yet.';
  const counts = new Map<BlockKind, number>();
  for (const b of blocks) counts.set(b.kind, (counts.get(b.kind) ?? 0) + 1);
  const parts = [...counts].map(([kind, n]) => `${n} ${PLURAL[kind](n)}`);
  return `${blocks.length} ${blocks.length === 1 ? 'region' : 'regions'}: ${parts.join(', ')}.`;
}
