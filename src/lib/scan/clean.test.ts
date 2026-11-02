import { describe, expect, it } from 'vitest';
import { cleanPage, detectPage, estimateSkew, flattenIllumination, removeRuledLines } from '@/lib/scan/clean';
import { applyHomography, homography, rotate, type Quad } from '@/lib/scan/geometry';
import { createGray, sample, type Gray } from '@/lib/scan/gray';

// Synthetic notebook pages with known geometry, so each step can be checked
// against the truth instead of by eye.

const PAGE_W = 600, PAGE_H = 800, RULE_GAP = 40, RULE_TOP = 60;
const DESCENDER_X = [100, 300, 500];
const INK = 0.15, RULE = 0.75, BACKGROUND = 0.3; // stored as float32, so compare ink with < 0.5

function fill(g: Gray, x0: number, y0: number, w: number, h: number, v: number) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) g.data[y * g.width + x] = v;
}

/** White paper, light ruled lines 2 px thick, a row of "words" on each line and descenders crossing it. */
function notebookPage(): Gray {
  const g = createGray(PAGE_W, PAGE_H, 1);
  for (let y = RULE_TOP; y < PAGE_H - 40; y += RULE_GAP) {
    fill(g, 0, y, PAGE_W, 2, RULE);
    for (let x = 40; x < PAGE_W - 80; x += 70) fill(g, x, y - 12, 45, 9, INK);
    for (const x of DESCENDER_X) fill(g, x, y - 12, 3, 24, INK);
  }
  return g;
}

/** Light falling off from 100% on the right to 55% on the left. */
function unevenlyLit(g: Gray): Gray {
  const out = createGray(g.width, g.height);
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) out.data[y * g.width + x] = g.data[y * g.width + x] * (0.55 + 0.45 * (x / g.width));
  }
  return out;
}

const PHOTO_QUAD: Quad = [{ x: 150, y: 120 }, { x: 760, y: 160 }, { x: 800, y: 1000 }, { x: 110, y: 960 }];

/** The page photographed at an angle on a dark desk. */
function photograph(page: Gray, quad: Quad = PHOTO_QUAD): Gray {
  const photo = createGray(900, 1100, BACKGROUND);
  const rect: Quad = [{ x: 0, y: 0 }, { x: page.width - 1, y: 0 }, { x: page.width - 1, y: page.height - 1 }, { x: 0, y: page.height - 1 }];
  const toPage = homography(quad, rect);
  for (let y = 0; y < photo.height; y++) {
    for (let x = 0; x < photo.width; x++) {
      const p = applyHomography(toPage, { x, y });
      if (p.x >= 0 && p.y >= 0 && p.x <= page.width - 1 && p.y <= page.height - 1) photo.data[y * photo.width + x] = sample(page, p.x, p.y);
    }
  }
  return photo;
}

const deg = (d: number) => (d * Math.PI) / 180;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const std = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

describe('detectPage', () => {
  it('finds the corners of a sheet photographed at an angle', () => {
    const found = detectPage(photograph(notebookPage()));
    expect(found).not.toBeNull();
    found!.forEach((corner, i) => {
      expect(Math.hypot(corner.x - PHOTO_QUAD[i].x, corner.y - PHOTO_QUAD[i].y)).toBeLessThan(12);
    });
  });

  it('leaves a photo alone when the page already fills it', () => {
    expect(detectPage(notebookPage())).toBeNull();
  });
});

describe('flattenIllumination', () => {
  it('evens out the paper and keeps the ink dark', () => {
    const page = notebookPage();
    const lit = unevenlyLit(page);
    const flat = flattenIllumination(lit);
    const paper = (g: Gray) => [...g.data].filter((_, i) => page.data[i] === 1);
    expect(std(paper(lit))).toBeGreaterThan(0.1);
    expect(std(paper(flat))).toBeLessThan(0.03);
    expect(mean(paper(flat))).toBeGreaterThan(0.95);
    const ink = [...flat.data].filter((_, i) => page.data[i] < 0.5);
    expect(ink.length).toBeGreaterThan(1000);
    expect(Math.max(...ink)).toBeLessThan(0.4);
  });
});

describe('estimateSkew', () => {
  for (const angle of [3, -5, 0, 8.5]) {
    it(`reads text tilted ${angle}°`, () => {
      const tilted = rotate(notebookPage(), deg(angle));
      expect(estimateSkew(tilted) * (180 / Math.PI)).toBeCloseTo(angle, 0);
      expect(Math.abs(estimateSkew(tilted) * (180 / Math.PI) - angle)).toBeLessThan(0.25);
    });
  }
});

describe('removeRuledLines', () => {
  it('erases ruled lines and keeps strokes that cross them', () => {
    const page = notebookPage();
    const cleaned = removeRuledLines(page, { horizontal: true, vertical: false });
    const ruleRows: number[] = [], crossings: number[] = [];
    for (let y = RULE_TOP; y < PAGE_H - 40; y += RULE_GAP) {
      for (const row of [y, y + 1]) {
        for (let x = 0; x < PAGE_W; x++) {
          const v = cleaned.data[row * PAGE_W + x];
          if (DESCENDER_X.some((d) => x >= d && x < d + 3)) crossings.push(v); else ruleRows.push(v);
        }
      }
    }
    expect(mean(ruleRows)).toBeGreaterThan(0.98);
    expect(Math.max(...crossings)).toBeLessThan(0.5);
  });

  it('keeps lines drawn in pen: a table rule on a ruled line, a fraction bar between lines, a graph axis', () => {
    const page = notebookPage();
    const tableRule = { x: 120, y: RULE_TOP + 4 * RULE_GAP, w: 300 }; // drawn over a printed rule
    const fractionBar = { x: 200, y: RULE_TOP + 6 * RULE_GAP + 20, w: 70 }; // between two rules
    const axis = { x: 450, y: RULE_TOP + 8 * RULE_GAP, h: 200 }; // upright
    fill(page, tableRule.x, tableRule.y, tableRule.w, 2, INK);
    fill(page, fractionBar.x, fractionBar.y, fractionBar.w, 2, INK);
    fill(page, axis.x, axis.y, 2, axis.h, INK);
    const cleaned = removeRuledLines(page, { horizontal: true, vertical: true });
    const values = (x0: number, y0: number, w: number, h: number) => {
      const out: number[] = [];
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push(cleaned.data[y * PAGE_W + x]);
      return out;
    };
    expect(Math.max(...values(tableRule.x, tableRule.y, tableRule.w, 2))).toBeLessThan(0.5);
    expect(Math.max(...values(fractionBar.x, fractionBar.y, fractionBar.w, 2))).toBeLessThan(0.5);
    expect(Math.max(...values(axis.x, axis.y, 2, axis.h))).toBeLessThan(0.5);
    // The rest of the printed rule under the table rule still goes, apart from the descenders crossing it.
    const rest: number[] = [];
    for (let x = 0; x < PAGE_W; x++) {
      if (x >= tableRule.x - 5 && x < tableRule.x + tableRule.w + 5) continue;
      if (DESCENDER_X.some((d) => x >= d && x < d + 3)) continue;
      rest.push(...values(x, tableRule.y, 1, 2));
    }
    expect(mean(rest)).toBeGreaterThan(0.98);
  });

  it('keeps a pen line that wanders a pixel and skips a few', () => {
    const page = notebookPage();
    const base = RULE_TOP + 5 * RULE_GAP + 18; // between two rules
    const drawn: number[] = [];
    for (let x = 100; x < 500; x++) {
      if (x % 100 < 3) continue; // the pen skips
      const y = base + (Math.floor(x / 50) % 2); // and wanders
      for (const row of [y, y + 1]) { page.data[row * PAGE_W + x] = INK; drawn.push(row * PAGE_W + x); }
    }
    const cleaned = removeRuledLines(page, { horizontal: true, vertical: false });
    expect(drawn.filter((i) => cleaned.data[i] < 0.5).length / drawn.length).toBeGreaterThan(0.95);
  });

  it('leaves no dots where a printed rule is as dark as ink for a short stretch', () => {
    const page = notebookPage();
    const y = RULE_TOP + 2 * RULE_GAP;
    // Dark stretches shorter than a line, more than half of the rule's length in all.
    for (let x = 0; x < PAGE_W - 30; x += 30) fill(page, x, y, 20, 2, INK);
    const cleaned = removeRuledLines(page, { horizontal: true, vertical: false });
    const rule: number[] = [];
    for (let x = 0; x < PAGE_W; x++) {
      if (!DESCENDER_X.some((d) => x >= d && x < d + 3)) rule.push(cleaned.data[y * PAGE_W + x], cleaned.data[(y + 1) * PAGE_W + x]);
    }
    expect(mean(rule)).toBeGreaterThan(0.98);
  });

  it('erases light grid lines, with no dots where one is as dark as ink for a short stretch', () => {
    const page = createGray(PAGE_W, PAGE_H, 1);
    const columns = [60, 120, 180, 240];
    for (const x of columns) fill(page, x, 0, 2, PAGE_H, RULE);
    // Dark stretches shorter than a line on one grid line.
    for (let y = 0; y < PAGE_H - 40; y += 40) fill(page, columns[1], y, 2, 25, INK);
    const cleaned = removeRuledLines(page, { horizontal: false, vertical: true });
    for (const x of columns) {
      const column: number[] = [];
      for (let y = 0; y < PAGE_H; y++) column.push(cleaned.data[y * PAGE_W + x], cleaned.data[y * PAGE_W + x + 1]);
      expect(mean(column), `grid line at ${x}`).toBeGreaterThan(0.98);
    }
  });

  it('leaves words alone', () => {
    const page = notebookPage();
    const cleaned = removeRuledLines(page, { horizontal: true, vertical: true });
    const words = [...cleaned.data].filter((_, i) => page.data[i] < 0.5);
    expect(words.length).toBeGreaterThan(1000);
    expect(mean(words)).toBeLessThan(0.2);
  });
});

describe('cleanPage', () => {
  it('straightens, evens out, deskews and de-lines a photographed page', () => {
    const page = unevenlyLit(rotate(notebookPage(), deg(2)));
    const photo = photograph(page);
    const { image, page: found, skewDegrees } = cleanPage(photo, { horizontal: true, vertical: false, maxSide: 2400 });

    expect(found).not.toBeNull();
    expect(Math.abs(skewDegrees - 2)).toBeLessThan(0.4);
    // Straightened to the sheet's proportions, measured along its longest edges.
    expect(image.width / image.height).toBeGreaterThan(0.7);
    expect(image.width / image.height).toBeLessThan(0.85);

    // A ruled line shows up as a row that is mostly not white.
    const lineRows = (g: Gray) => {
      let rows = 0;
      for (let y = 0; y < g.height; y++) {
        let marked = 0;
        for (let x = 0; x < g.width; x++) if (g.data[y * g.width + x] < 0.95) marked++;
        if (marked > g.width * 0.6) rows++;
      }
      return rows;
    };
    const withLines = cleanPage(photo, { horizontal: false, vertical: false, maxSide: 2400 }).image;
    expect(lineRows(withLines)).toBeGreaterThanOrEqual(15);
    expect(lineRows(image)).toBe(0);

    const dark = (g: Gray) => [...g.data].filter((v) => v < 0.4).length / g.data.length;
    expect(dark(image)).toBeGreaterThan(dark(notebookPage()) * 0.6);
  });

  it('gives the same geometry whichever lines it removes, so marked regions stay on what they marked', () => {
    // Changing a cleanup option cleans a page again. Regions are stored in the cleaned
    // page's pixels, so line removal must never move, resize or turn the page.
    const photo = photograph(unevenlyLit(rotate(notebookPage(), deg(2))));
    const runs = [false, true].flatMap((horizontal) => [false, true].map((vertical) =>
      cleanPage(photo, { horizontal, vertical, maxSide: 2400 })));
    // Where the ink sits pins down any move or turn, even one that keeps the size.
    const inkBounds = (g: Gray) => {
      let left = g.width, right = -1, top = g.height, bottom = -1;
      for (let y = 0; y < g.height; y++) {
        for (let x = 0; x < g.width; x++) {
          if (g.data[y * g.width + x] >= 0.3) continue;
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
      return { left, right, top, bottom };
    };
    const geometry = runs.map(({ image, page, skewDegrees }) => ({ width: image.width, height: image.height, page, skewDegrees, ink: inkBounds(image) }));
    expect(geometry[0].ink.right).toBeGreaterThan(geometry[0].ink.left);
    for (const g of geometry.slice(1)) expect(g).toEqual(geometry[0]);
  });

  it('shrinks very large photos to the working size first', () => {
    const big = createGray(5000, 3000, 1);
    const { image } = cleanPage(big, { horizontal: false, vertical: false, maxSide: 2400 });
    expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(2400);
  });
});
