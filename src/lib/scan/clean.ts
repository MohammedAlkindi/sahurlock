import {
  boxBlur, createGray, downsample, extremumFilter, otsuThreshold, resize, type Gray,
} from '@/lib/scan/gray';
import { rotate, warpPerspective, type Point, type Quad } from '@/lib/scan/geometry';

// ── Page outline ──────────────────────────────────────────────────────────────

/**
 * Find a sheet of paper that is brighter than what it lies on and return its
 * corners in `g`'s pixels, or null when no single sheet stands out (the page
 * fills the photo, or the background is as bright as the paper).
 */
export function detectPage(g: Gray): Quad | null {
  const factor = Math.max(1, Math.ceil(Math.max(g.width, g.height) / 400));
  const small = boxBlur(downsample(g, factor), 2);
  const { width: w, height: h, data } = small;
  const threshold = otsuThreshold(small);

  // Largest 4-connected bright region.
  const label = new Int32Array(w * h).fill(-1);
  const queue = new Int32Array(w * h);
  let best = { id: -1, size: 0 };
  for (let start = 0, id = 0; start < w * h; start++) {
    if (label[start] !== -1 || data[start] <= threshold) continue;
    let head = 0, tail = 0, size = 0;
    queue[tail++] = start; label[start] = id;
    while (head < tail) {
      const i = queue[head++]; size++;
      const x = i % w, y = (i - x) / w;
      const neighbours = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const n of neighbours) {
        if (n >= 0 && label[n] === -1 && data[n] > threshold) { label[n] = id; queue[tail++] = n; }
      }
    }
    if (size > best.size) best = { id, size };
    id++;
  }
  if (best.size < 0.2 * w * h) return null;

  // Corners are the region's extremes along the two diagonals.
  let tl = { s: Infinity, x: 0, y: 0 }, br = { s: -Infinity, x: 0, y: 0 };
  let tr = { s: -Infinity, x: 0, y: 0 }, bl = { s: Infinity, x: 0, y: 0 };
  const touches = { left: false, right: false, top: false, bottom: false };
  for (let i = 0; i < w * h; i++) {
    if (label[i] !== best.id) continue;
    const x = i % w, y = (i - x) / w;
    if (x === 0) touches.left = true;
    if (x === w - 1) touches.right = true;
    if (y === 0) touches.top = true;
    if (y === h - 1) touches.bottom = true;
    if (x + y < tl.s) tl = { s: x + y, x, y };
    if (x + y > br.s) br = { s: x + y, x, y };
    if (x - y > tr.s) tr = { s: x - y, x, y };
    if (x - y < bl.s) bl = { s: x - y, x, y };
  }
  if (Object.values(touches).filter(Boolean).length >= 3) return null;

  // Corners are only as precise as the shrunk image, so pull each one in by a
  // pixel and a half of it. Otherwise a sliver of desk can line the page edge.
  const corners = [tl, tr, br, bl].map((p) => ({ x: (p.x + 0.5) * factor, y: (p.y + 0.5) * factor }));
  const cx = corners.reduce((sum, p) => sum + p.x, 0) / 4;
  const cy = corners.reduce((sum, p) => sum + p.y, 0) / 4;
  const inset = (p: Point): Point => {
    const d = Math.hypot(p.x - cx, p.y - cy) || 1;
    const by = 1.5 * factor;
    return { x: p.x + ((cx - p.x) / d) * by, y: p.y + ((cy - p.y) / d) * by };
  };
  return corners.map(inset) as Quad;
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Straighten the page inside `quad` into a rectangle with the sheet's proportions. */
export function straightenPage(g: Gray, quad: Quad): Gray {
  const [tl, tr, br, bl] = quad;
  const width = Math.round(Math.max(distance(tl, tr), distance(bl, br)));
  const height = Math.round(Math.max(distance(tl, bl), distance(tr, br)));
  return warpPerspective(g, quad, Math.max(1, width), Math.max(1, height));
}

// ── Lighting ──────────────────────────────────────────────────────────────────

/**
 * Even out shadows and uneven light. The paper's brightness is estimated on a
 * coarse grid with the ink filtered out (a local maximum), smoothed, and
 * divided out, so paper reads close to 1 everywhere and ink keeps its contrast.
 */
export function flattenIllumination(g: Gray): Gray {
  const factor = Math.max(1, Math.round(Math.min(g.width, g.height) / 120));
  const coarse = downsample(g, factor);
  const paper = boxBlur(extremumFilter(coarse, 3, 3, true), 3);
  const background = resize(paper, g.width, g.height);
  const out = createGray(g.width, g.height);
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = Math.min(1, g.data[i] / Math.max(background.data[i], 0.05));
  }
  return out;
}

// ── Skew ──────────────────────────────────────────────────────────────────────

/**
 * The angle of the text lines in radians, positive when they run down to the
 * right, found by the projection-profile method: rotate the ink's coordinates
 * and keep the angle whose row histogram is sharpest. Searches ±10°.
 */
export function estimateSkew(g: Gray): number {
  const factor = Math.max(1, Math.round(g.width / 600));
  const small = downsample(g, factor);
  const threshold = Math.min(otsuThreshold(small), 0.75);
  const xs: number[] = [], ys: number[] = [];
  const cx = small.width / 2, cy = small.height / 2;
  for (let y = 0; y < small.height; y++) {
    for (let x = 0; x < small.width; x++) {
      if (small.data[y * small.width + x] < threshold) { xs.push(x - cx); ys.push(y - cy); }
    }
  }
  if (xs.length < small.data.length * 0.002) return 0;

  const rows = Math.ceil(Math.hypot(small.width, small.height)) + 2;
  const hist = new Float64Array(rows);
  const score = (angle: number) => {
    hist.fill(0);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    for (let i = 0; i < xs.length; i++) hist[Math.round(ys[i] * cos - xs[i] * sin + rows / 2)]++;
    let s = 0;
    for (const v of hist) s += v * v;
    return s;
  };
  const search = (from: number, to: number, step: number) => {
    let bestAngle = from, bestScore = -1;
    for (let a = from; a <= to + 1e-9; a += step) {
      const s = score(a);
      if (s > bestScore) { bestScore = s; bestAngle = a; }
    }
    return bestAngle;
  };
  const deg = Math.PI / 180;
  const coarse = search(-10 * deg, 10 * deg, 0.5 * deg);
  return search(coarse - 0.5 * deg, coarse + 0.5 * deg, 0.05 * deg);
}

// ── Ruled and grid lines ──────────────────────────────────────────────────────

export interface LineRemoval {
  horizontal: boolean;
  vertical: boolean;
}

/**
 * Erase ruled (horizontal) and grid (vertical) lines. A line is a run of
 * darker-than-paper pixels at least a tenth of the page long. Where writing
 * crosses a line, the crossing stroke is longer across the line than the line
 * is thick, so those pixels are kept. Long underlines count as lines.
 */
export function removeRuledLines(g: Gray, which: LineRemoval): Gray {
  const out = { width: g.width, height: g.height, data: g.data.slice() };
  const candidate = createGray(g.width, g.height, 0);
  const ink = createGray(g.width, g.height, 0);
  for (let i = 0; i < g.data.length; i++) {
    candidate.data[i] = g.data[i] < 0.9 ? 1 : 0;
    ink.data[i] = g.data[i] < 0.6 ? 1 : 0;
  }
  const open = (mask: Gray, rx: number, ry: number) =>
    extremumFilter(extremumFilter(mask, rx, ry, false), rx, ry, true);

  const erase = (lines: Gray, crossing: Gray) => {
    for (let i = 0; i < out.data.length; i++) {
      if (lines.data[i] > 0 && crossing.data[i] === 0) out.data[i] = 1;
    }
  };

  if (which.horizontal) {
    const length = Math.max(15, Math.floor(g.width / 10));
    // Grown by a pixel across the line to catch its soft edges.
    const lines = extremumFilter(open(candidate, length >> 1, 0), 0, 1, true);
    erase(lines, open(ink, 0, 4));
  }
  if (which.vertical) {
    const length = Math.max(15, Math.floor(g.height / 10));
    const lines = extremumFilter(open(candidate, 0, length >> 1), 1, 0, true);
    erase(lines, open(ink, 4, 0));
  }
  return out;
}

// ── Whole page ────────────────────────────────────────────────────────────────

export interface CleanOptions extends LineRemoval {
  /** Longest side to work at, in pixels. Bigger photos are shrunk first. */
  maxSide: number;
}

export interface CleanResult {
  image: Gray;
  /** The page outline found in the (shrunk) photo, or null if the photo was used as it was. */
  page: Quad | null;
  skewDegrees: number;
}

export const DEFAULT_CLEAN_OPTIONS: CleanOptions = { horizontal: true, vertical: false, maxSide: 2400 };

export function cleanPage(input: Gray, options: CleanOptions = DEFAULT_CLEAN_OPTIONS): CleanResult {
  let image = input;
  const longest = Math.max(input.width, input.height);
  if (longest > options.maxSide) image = downsample(input, Math.ceil(longest / options.maxSide));

  const page = detectPage(image);
  if (page) image = straightenPage(image, page);

  image = flattenIllumination(image);
  const skew = estimateSkew(image);
  if (Math.abs(skew) > (0.1 * Math.PI) / 180) image = rotate(image, -skew);
  if (options.horizontal || options.vertical) image = removeRuledLines(image, options);

  // Paper to pure white, so prints and exports carry no grey cast.
  for (let i = 0; i < image.data.length; i++) image.data[i] = Math.min(1, image.data[i] / 0.92);

  return { image, page, skewDegrees: (skew * 180) / Math.PI };
}
