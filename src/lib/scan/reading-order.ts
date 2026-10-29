import type { Box } from '@/lib/scan/document';

type Axis = 'x' | 'y';

const start = (box: Box, axis: Axis) => (axis === 'y' ? box.y : box.x);
const end = (box: Box, axis: Axis) => (axis === 'y' ? box.y + box.height : box.x + box.width);

/**
 * Splits items where a strip across the page on `axis` crosses none of them, and returns the
 * groups in order along it. Boxes that only touch are split. Ties keep their input order.
 */
function split<T extends { box: Box }>(items: readonly T[], axis: Axis): T[][] {
  const sorted = [...items].sort((a, b) => start(a.box, axis) - start(b.box, axis));
  const groups: T[][] = [];
  let reach = -Infinity;
  for (const item of sorted) {
    const group = groups.at(-1);
    if (group && start(item.box, axis) < reach) group.push(item);
    else groups.push([item]);
    reach = Math.max(reach, end(item.box, axis));
  }
  return groups;
}

const topThenLeft = (a: { box: Box }, b: { box: Box }) => a.box.y - b.box.y || a.box.x - b.box.x;

/**
 * The order to read a page's regions in, by recursive XY-cut. Where a horizontal strip of the
 * page crosses no region, everything above it is read before everything below. Within such a
 * band, where a vertical strip crosses no region, left is read before right. Each part is cut
 * again the same way. When no strip separates a group, because a region overlaps or encloses
 * the others, its topmost region, then leftmost, is read first and the rest is cut again.
 *
 * Bands are cut before columns, so two columns are read one after the other only when no
 * horizontal gap runs across both. Returns a new array and leaves `items` as it is.
 */
export function readingOrder<T extends { box: Box }>(items: readonly T[]): T[] {
  const read: T[] = [];
  const rest = [...items];
  while (rest.length > 1) {
    const bands = split(rest, 'y');
    if (bands.length > 1) return read.concat(bands.flatMap(readingOrder));
    const columns = split(rest, 'x');
    if (columns.length > 1) return read.concat(columns.flatMap(readingOrder));
    // Ties keep the marked order, as the first of equals wins.
    const first = rest.reduce((best, item, i) => (topThenLeft(item, rest[best]) < 0 ? i : best), 0);
    read.push(...rest.splice(first, 1));
  }
  return read.concat(rest);
}
