import { describe, expect, it } from 'vitest';
import { DETECT_SIDE, detectorInput, suggestionsFrom } from '@/lib/scan/detect';

const page = { width: 1240, height: 1754 };
/** Finder rows: class index, score, then the box corners. */
const rows = (...r: number[][]) => new Float32Array(r.flat());

// Class indices from PP-DocLayout-S's label list.
const PARAGRAPH_TITLE = 0, IMAGE = 1, TEXT = 2, NUMBER = 3, FORMULA = 7, TABLE = 8, CHART = 18;

describe('suggestionsFrom', () => {
  it('turns the finder\'s classes into kinds, in reading order', () => {
    const found = suggestionsFrom(rows(
      [TABLE, 0.84, 147, 691, 1052, 940],
      [TEXT, 0.89, 95, 299, 939, 471],
      [PARAGRAPH_TITLE, 0.84, 98, 233, 619, 269],
      [FORMULA, 0.72, 298, 540, 714, 584],
      [CHART, 0.58, 192, 1085, 903, 1501],
    ), 5, page);
    expect(found.map((s) => s.kind)).toEqual(['heading', 'text', 'math', 'table', 'graph']);
    expect(found[0].box).toEqual({ x: 98, y: 233, width: 521, height: 36 });
  });

  it('drops weak rows, rows past the count, and classes that are not regions', () => {
    const found = suggestionsFrom(rows(
      [TEXT, 0.49, 0, 0, 100, 100],
      [NUMBER, 0.95, 600, 1700, 640, 1740],
      [TABLE, 0.9, 100, 200, 900, 600],
      [TEXT, 0.99, 100, 800, 900, 900],
    ), 3, page);
    expect(found.map((s) => s.kind)).toEqual(['table']);
  });

  it('drops a box mostly inside a stronger one, or inside a region already on the page', () => {
    // In the model's order, by class, so the weaker picture comes first.
    const found = suggestionsFrom(rows(
      [IMAGE, 0.57, 191, 1090, 904, 1502], // the picture found as a chart below, a little weaker
      [TEXT, 0.89, 95, 299, 939, 471],
      [FORMULA, 0.51, 700, 347, 928, 379], // an inline formula in the paragraph
      [TABLE, 0.84, 147, 691, 1052, 940],
      [CHART, 0.58, 192, 1085, 903, 1501],
    ), 5, page, [{ x: 140, y: 680, width: 920, height: 270 }]);
    expect(found.map((s) => s.kind)).toEqual(['text', 'graph']);
  });

  it('suggests a paragraph once when it is also found whole, more weakly, around its halves', () => {
    const found = suggestionsFrom(rows(
      [TEXT, 0.58, 124, 397, 1466, 643],
      [TEXT, 0.65, 120, 399, 1452, 514],
      [TEXT, 0.64, 120, 532, 1459, 650],
    ), 3, { width: 1600, height: 2100 });
    expect(found.map((s) => [s.box.y, s.box.height])).toEqual([[399, 115], [532, 118]]);
  });

  it('keeps every box on the page', () => {
    const [s] = suggestionsFrom(rows([TEXT, 0.9, -20, 1700, 1300, 1900]), 1, page);
    expect(s.box.x).toBe(0);
    expect(s.box.x + s.box.width).toBeLessThanOrEqual(page.width);
    expect(s.box.y + s.box.height).toBeLessThanOrEqual(page.height);
  });
});

describe('detectorInput', () => {
  it('lays out the red, green and blue planes, normalised as the model was trained', () => {
    const pixels = new Uint8ClampedArray(DETECT_SIDE * DETECT_SIDE * 4).fill(255);
    pixels.set([0, 128, 255, 255], 0); // the first pixel
    const input = detectorInput(pixels);
    const plane = DETECT_SIDE * DETECT_SIDE;
    expect(input).toHaveLength(plane * 3);
    expect(input[0]).toBeCloseTo((0 - 0.485) / 0.229, 5);
    expect(input[plane]).toBeCloseTo((128 / 255 - 0.456) / 0.224, 5);
    expect(input[2 * plane]).toBeCloseTo((1 - 0.406) / 0.225, 5);
    expect(input[1]).toBeCloseTo((1 - 0.485) / 0.229, 5);
  });

  it('refuses pixels of another size', () => {
    expect(() => detectorInput(new Uint8ClampedArray(16))).toThrow();
  });
});
