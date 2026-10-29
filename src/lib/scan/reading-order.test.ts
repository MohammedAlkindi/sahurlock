import { describe, expect, it } from 'vitest';
import type { Box } from '@/lib/scan/document';
import { readingOrder } from '@/lib/scan/reading-order';

interface Region {
  id: string;
  box: Box;
}

const region = (id: string, x: number, y: number, width: number, height: number): Region => ({ id, box: { x, y, width, height } });
const ids = (regions: Region[]) => readingOrder(regions).map((r) => r.id);

describe('readingOrder', () => {
  it('returns nothing for no regions and the one region for one', () => {
    expect(readingOrder([])).toEqual([]);
    expect(ids([region('a', 10, 10, 50, 20)])).toEqual(['a']);
  });

  it('reads a single column top to bottom, whatever order the regions were marked in', () => {
    expect(ids([region('c', 40, 300, 500, 80), region('a', 40, 20, 500, 60), region('b', 60, 120, 400, 140)])).toEqual(['a', 'b', 'c']);
  });

  it('reads regions side by side left to right, a row at a time', () => {
    expect(ids([
      region('row2-right', 320, 220, 200, 80), region('row1-right', 320, 20, 200, 120),
      region('row2-left', 20, 230, 250, 60), region('row1-left', 20, 40, 250, 90),
    ])).toEqual(['row1-left', 'row1-right', 'row2-left', 'row2-right']);
  });

  it('reads a full-width title, then each column top to bottom', () => {
    // The gaps between each column's regions are at different heights, so no horizontal gap runs across both.
    expect(ids([
      region('right-2', 320, 330, 260, 200), region('left-1', 20, 100, 260, 180),
      region('title', 20, 20, 560, 50), region('right-1', 320, 100, 260, 200),
      region('left-2', 20, 290, 260, 250),
    ])).toEqual(['title', 'left-1', 'left-2', 'right-1', 'right-2']);
  });

  it('reads two columns row by row when a horizontal gap runs across both', () => {
    expect(ids([
      region('left-1', 20, 20, 260, 100), region('right-1', 320, 20, 260, 100),
      region('left-2', 20, 150, 260, 100), region('right-2', 320, 150, 260, 100),
    ])).toEqual(['left-1', 'right-1', 'left-2', 'right-2']);
  });

  it('cuts again inside a column', () => {
    // A column whose second row holds a graph beside its caption. The caption starts higher, so
    // only cutting the column again puts the graph first.
    expect(ids([
      region('right', 320, 20, 260, 500), region('caption', 160, 170, 120, 60),
      region('graph', 20, 180, 120, 120), region('text', 20, 20, 260, 120),
    ])).toEqual(['text', 'graph', 'caption', 'right']);
  });

  it('splits regions that only touch', () => {
    expect(ids([region('b', 0, 50, 100, 50), region('a', 0, 0, 100, 50)])).toEqual(['a', 'b']);
    // Side by side, the right one starting higher: kept together, they would be read top first.
    expect(ids([region('right', 50, 0, 50, 100), region('left', 0, 20, 50, 100)])).toEqual(['left', 'right']);
  });

  it('reads a region that encloses others first, then cuts what is inside it', () => {
    // A diagram with three labels drawn inside it.
    expect(ids([
      region('label-low', 60, 200, 80, 30), region('diagram', 20, 20, 400, 300),
      region('label-right', 300, 60, 80, 30), region('label-left', 40, 60, 80, 30),
    ])).toEqual(['diagram', 'label-left', 'label-right', 'label-low']);
  });

  it('keeps columns apart when one region blocks every cut', () => {
    const columns = [
      region('L1', 20, 100, 260, 180), region('R1', 320, 100, 260, 200), region('L2', 20, 290, 260, 250),
      region('R2', 320, 330, 260, 240), region('L3', 20, 560, 260, 200), region('R3', 320, 590, 260, 170),
    ];
    // A heading drawn a little into the first paragraph, so no horizontal strip separates it.
    expect(ids([region('T', 20, 20, 560, 85), ...columns])).toEqual(['T', 'L1', 'L2', 'L3', 'R1', 'R2', 'R3']);
    // A box drawn around the whole body.
    expect(ids([region('T', 20, 20, 560, 60), region('body', 10, 90, 580, 680), ...columns]))
      .toEqual(['T', 'body', 'L1', 'L2', 'L3', 'R1', 'R2', 'R3']);
  });

  it('keeps the marked order for regions in the same place', () => {
    expect(ids([region('first', 10, 10, 50, 50), region('second', 10, 10, 50, 50)])).toEqual(['first', 'second']);
  });

  it('returns the same objects in a new array and leaves the input as it was', () => {
    const regions = [region('b', 0, 100, 10, 10), region('a', 0, 0, 10, 10)];
    const ordered = readingOrder(regions);
    expect(ordered).not.toBe(regions);
    expect(regions.map((r) => r.id)).toEqual(['b', 'a']);
    expect(ordered[0]).toBe(regions[1]);
    const one = [region('a', 0, 0, 10, 10)];
    expect(readingOrder(one)).not.toBe(one);
    // Regions no strip separates.
    const nested = [region('inner', 40, 40, 10, 10), region('outer', 0, 0, 100, 100)];
    expect(ids(nested)).toEqual(['outer', 'inner']);
    expect(nested.map((r) => r.id)).toEqual(['inner', 'outer']);
  });
});
