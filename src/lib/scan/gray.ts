/**
 * A grayscale image with values from 0 (black ink) to 1 (white paper), row by
 * row. Every step of the page cleanup works on this, so it runs the same in a
 * worker, the main thread or a unit test.
 */
export interface Gray {
  width: number;
  height: number;
  data: Float32Array;
}

export const createGray = (width: number, height: number, fill = 1): Gray =>
  ({ width, height, data: new Float32Array(width * height).fill(fill) });

export const cloneGray = (g: Gray): Gray => ({ width: g.width, height: g.height, data: g.data.slice() });

export function grayFromRGBA(rgba: ArrayLike<number>, width: number, height: number): Gray {
  const out = createGray(width, height);
  for (let i = 0; i < width * height; i++) {
    out.data[i] = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
  }
  return out;
}

export function rgbaFromGray(g: Gray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(g.width * g.height * 4);
  for (let i = 0; i < g.width * g.height; i++) {
    const v = Math.round(Math.min(1, Math.max(0, g.data[i])) * 255);
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Bilinear sample with edge clamping. */
export function sample(g: Gray, x: number, y: number): number {
  const cx = Math.min(Math.max(x, 0), g.width - 1);
  const cy = Math.min(Math.max(y, 0), g.height - 1);
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, g.width - 1), y1 = Math.min(y0 + 1, g.height - 1);
  const fx = cx - x0, fy = cy - y0;
  const d = g.data, w = g.width;
  const top = d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx;
  const bottom = d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Shrink by averaging whole blocks of pixels. `factor` is a whole number of at least 1. */
export function downsample(g: Gray, factor: number): Gray {
  const f = Math.max(1, Math.floor(factor));
  if (f === 1) return cloneGray(g);
  const w = Math.max(1, Math.floor(g.width / f)), h = Math.max(1, Math.floor(g.height / f));
  const out = createGray(w, h, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < f; dy++) {
        const row = (y * f + dy) * g.width + x * f;
        for (let dx = 0; dx < f; dx++) sum += g.data[row + dx];
      }
      out.data[y * w + x] = sum / (f * f);
    }
  }
  return out;
}

/** Resize to an exact size with bilinear sampling. */
export function resize(g: Gray, width: number, height: number): Gray {
  const out = createGray(width, height);
  const sx = g.width / width, sy = g.height / height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out.data[y * width + x] = sample(g, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5);
    }
  }
  return out;
}

/** Running-sum box blur, separable, radius in pixels. */
export function boxBlur(g: Gray, radius: number): Gray {
  const r = Math.max(0, Math.floor(radius));
  if (r === 0) return cloneGray(g);
  const pass = (src: Float32Array, len: number, count: number, stride: number, step: number) => {
    const dst = new Float32Array(src.length);
    for (let line = 0; line < count; line++) {
      const base = line * stride;
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src[base + Math.min(Math.max(i, 0), len - 1) * step];
      for (let i = 0; i < len; i++) {
        dst[base + i * step] = sum / (2 * r + 1);
        sum += src[base + Math.min(i + r + 1, len - 1) * step] - src[base + Math.max(i - r, 0) * step];
      }
    }
    return dst;
  };
  const horizontal = pass(g.data, g.width, g.height, g.width, 1);
  const vertical = pass(horizontal, g.height, g.width, 1, g.width);
  return { width: g.width, height: g.height, data: vertical };
}

/**
 * Maximum (or minimum) over a window of 2·radius+1 pixels along one axis,
 * with a monotonic queue so the cost does not grow with the radius.
 */
function extremumPass(src: Float32Array, len: number, count: number, stride: number, step: number, radius: number, max: boolean) {
  const dst = new Float32Array(src.length);
  const queue = new Int32Array(len);
  const better = (a: number, b: number) => (max ? a >= b : a <= b);
  for (let line = 0; line < count; line++) {
    const base = line * stride;
    let head = 0, tail = 0, next = 0;
    for (let i = 0; i < len; i++) {
      const end = Math.min(len - 1, i + radius);
      while (next <= end) {
        const v = src[base + next * step];
        while (tail > head && better(v, src[base + queue[tail - 1] * step])) tail--;
        queue[tail++] = next++;
      }
      while (queue[head] < i - radius) head++;
      dst[base + i * step] = src[base + queue[head] * step];
    }
  }
  return dst;
}

/** Grayscale dilation (max) or erosion (min) with a rectangular window of half-size rx by ry. */
export function extremumFilter(g: Gray, rx: number, ry: number, max: boolean): Gray {
  let data = g.data;
  if (rx > 0) data = extremumPass(data, g.width, g.height, g.width, 1, Math.floor(rx), max);
  if (ry > 0) data = extremumPass(data, g.height, g.width, 1, g.width, Math.floor(ry), max);
  return { width: g.width, height: g.height, data: data === g.data ? g.data.slice() : data };
}

/** Otsu's threshold on values in [0, 1]. */
export function otsuThreshold(g: Gray, bins = 256): number {
  const hist = new Float64Array(bins);
  for (const v of g.data) hist[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))]++;
  const total = g.data.length;
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * hist[i];
  let sumBelow = 0, countBelow = 0, best = 0, bestVar = -1;
  for (let i = 0; i < bins; i++) {
    countBelow += hist[i];
    if (countBelow === 0) continue;
    const countAbove = total - countBelow;
    if (countAbove === 0) break;
    sumBelow += i * hist[i];
    const meanBelow = sumBelow / countBelow;
    const meanAbove = (sumAll - sumBelow) / countAbove;
    const between = countBelow * countAbove * (meanBelow - meanAbove) ** 2;
    if (between > bestVar) { bestVar = between; best = i; }
  }
  return (best + 1) / bins;
}
