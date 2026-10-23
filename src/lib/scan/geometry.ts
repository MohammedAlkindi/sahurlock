import { createGray, sample, type Gray } from '@/lib/scan/gray';

export interface Point { x: number; y: number }

/** A page outline: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

/** Solve A·x = b for a small dense system by Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const p = m[col][col];
    if (Math.abs(p) < 1e-12) throw new Error('Degenerate page outline.');
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / p;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** The homography taking each `from` point to the matching `to` point, as a row-major 3×3 matrix. */
export function homography(from: Quad, to: Quad): number[] {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], { x: u, y: v } = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return [...solve(a, b), 1];
}

export function applyHomography(h: number[], p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

/** Cut the quadrilateral `quad` out of `g` and straighten it into a width × height rectangle. */
export function warpPerspective(g: Gray, quad: Quad, width: number, height: number): Gray {
  const rect: Quad = [{ x: 0, y: 0 }, { x: width - 1, y: 0 }, { x: width - 1, y: height - 1 }, { x: 0, y: height - 1 }];
  const h = homography(rect, quad);
  const out = createGray(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = applyHomography(h, { x, y });
      out.data[y * width + x] = sample(g, p.x, p.y);
    }
  }
  return out;
}

/** Rotate about the centre by `radians` (positive turns the content clockwise on screen). Uncovered corners become paper. */
export function rotate(g: Gray, radians: number): Gray {
  const out = createGray(g.width, g.height, 1);
  const cos = Math.cos(radians), sin = Math.sin(radians);
  const cx = (g.width - 1) / 2, cy = (g.height - 1) / 2;
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      // Inverse mapping: find where this output pixel came from.
      const dx = x - cx, dy = y - cy;
      const sx = cos * dx + sin * dy + cx;
      const sy = -sin * dx + cos * dy + cy;
      if (sx < -0.5 || sy < -0.5 || sx > g.width - 0.5 || sy > g.height - 0.5) continue;
      out.data[y * g.width + x] = sample(g, sx, sy);
    }
  }
  return out;
}
