import { describe, expect, it } from 'vitest';
import { decodeDocument, DOCUMENT_VERSION, userBlock } from '@/lib/scan/document';
import { clampBox, minSide, moveBox, newBoxBelow, position, resizeBox, stepSize, summary } from '@/lib/scan/regions';

const page = { width: 1700, height: 2200 };
const block = (id: string, box: { x: number; y: number; width: number; height: number }, kind: Parameters<typeof userBlock>[1] = 'text') =>
  userBlock(id, kind, box);

describe('sizes', () => {
  it('scale with the page and have a floor', () => {
    expect(minSide(page)).toBe(11);
    expect(stepSize(page)).toBe(22);
    expect(minSide({ width: 400, height: 500 })).toBe(8);
    expect(stepSize({ width: 40, height: 50 })).toBe(1);
  });
});

describe('clampBox', () => {
  it('keeps a box inside every edge of the page, in whole pixels', () => {
    expect(clampBox({ x: -30, y: 10.4, width: 200.6, height: 50 }, page)).toEqual({ x: 0, y: 10, width: 201, height: 50 });
    expect(clampBox({ x: 1600, y: 0, width: 300, height: 50 }, page)).toEqual({ x: 1400, y: 0, width: 300, height: 50 });
    expect(clampBox({ x: 0, y: -5, width: 300, height: 50 }, page)).toEqual({ x: 0, y: 0, width: 300, height: 50 });
    expect(clampBox({ x: 0, y: 2190, width: 300, height: 50 }, page)).toEqual({ x: 0, y: 2150, width: 300, height: 50 });
  });

  it('never goes below the minimum size or above the page size', () => {
    expect(clampBox({ x: 10, y: 10, width: 2, height: 0 }, page)).toMatchObject({ width: 11, height: 11 });
    expect(clampBox({ x: 10, y: 10, width: 5000, height: 5000 }, page)).toEqual({ x: 0, y: 0, width: 1700, height: 2200 });
  });
});

describe('moveBox and resizeBox', () => {
  const box = { x: 100, y: 100, width: 300, height: 60 };

  it('moves by the step and stops at the edges', () => {
    expect(moveBox(box, 22, -22, page)).toEqual({ x: 122, y: 78, width: 300, height: 60 });
    expect(moveBox(box, -500, 0, page).x).toBe(0);
    expect(moveBox(box, 5000, 5000, page)).toMatchObject({ x: 1400, y: 2140 });
  });

  it('resizes from the bottom-right corner, never below the minimum or past the page', () => {
    expect(resizeBox(box, 22, 22, page)).toEqual({ x: 100, y: 100, width: 322, height: 82 });
    expect(resizeBox(box, -1000, -1000, page)).toMatchObject({ width: 11, height: 11 });
    expect(resizeBox(box, 5000, 5000, page)).toMatchObject({ width: 1600, height: 2100 });
  });
});

describe('newBoxBelow', () => {
  it('puts the first box near the top, most of the page wide', () => {
    expect(newBoxBelow([], page)).toEqual({ x: 170, y: 220, width: 1360, height: 176 });
  });

  it('puts the next box just below the last one, lined up with it', () => {
    const last = block('a', { x: 200, y: 400, width: 900, height: 120 });
    expect(newBoxBelow([block('z', { x: 0, y: 0, width: 50, height: 50 }), last], page)).toEqual({ x: 200, y: 542, width: 900, height: 176 });
  });

  it('stays on the page at the bottom', () => {
    const last = block('a', { x: 200, y: 2100, width: 900, height: 100 });
    expect(newBoxBelow([last], page)).toEqual({ x: 200, y: 2024, width: 900, height: 176 });
  });
});

describe('position', () => {
  it('names all nine thirds of the page', () => {
    const at = (cx: number, cy: number) => position({ x: cx - 10, y: cy - 10, width: 20, height: 20 }, page);
    const xs = [100, 850, 1600], ys = [100, 1100, 2100];
    expect(ys.map((y) => xs.map((x) => at(x, y)))).toEqual([
      ['top left', 'top', 'top right'],
      ['left', 'middle', 'right'],
      ['bottom left', 'bottom', 'bottom right'],
    ]);
  });
});

describe('summary', () => {
  it('counts regions by kind', () => {
    const box = { x: 0, y: 0, width: 20, height: 20 };
    expect(summary([])).toBe('No regions yet.');
    expect(summary([block('a', box)])).toBe('1 region: 1 text.');
    const blocks = [
      block('a', box), block('b', box, 'math'), block('c', box), block('d', box, 'graph'), block('e', box), block('f', box, 'heading'), block('g', box, 'heading'),
    ];
    expect(summary(blocks)).toBe('7 regions: 3 text, 1 math, 1 graph, 2 headings.');
  });
});

describe('boxes from the editor', () => {
  it('all decode as Document regions', () => {
    const boxes = [
      clampBox({ x: -5, y: -5, width: 1, height: 1 }, page),
      moveBox({ x: 1690, y: 2190, width: 50, height: 50 }, 30, 30, page),
      resizeBox({ x: 1600, y: 2100, width: 50, height: 50 }, 900, 900, page),
      newBoxBelow([block('a', { x: 200, y: 2150, width: 900, height: 50 })], page),
    ];
    const doc = { version: DOCUMENT_VERSION, pages: [{ ...page, regionsComplete: false, blocks: boxes.map((b, i) => block(`r${i}`, b)) }] };
    expect(decodeDocument(doc)?.pages[0].blocks).toHaveLength(boxes.length);
  });
});
