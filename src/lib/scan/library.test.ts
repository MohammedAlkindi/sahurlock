import { describe, expect, it } from 'vitest';
import { DOCUMENT_VERSION, emptyDocument, userBlock } from '@/lib/scan/document';
import { decodeSavedScan, groupByCourse, scanFileName, type SavedScan, withPageAdded, withPageRemoved } from '@/lib/scan/library';

const page = () => ({ jpeg: new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' }), width: 1700, height: 2200 });
const scan = (overrides: Record<string, unknown> = {}) => ({
  id: 's1', title: 'Week 4 lecture', course: 'CSE 12', createdAt: '2026-10-23T06:00:00.000Z', pages: [page(), page()], ...overrides,
});

describe('decodeSavedScan', () => {
  it('keeps a well-formed scan', () => {
    const value = scan();
    expect(decodeSavedScan(value)).toEqual({ ...value, document: emptyDocument([{ width: 1700, height: 2200 }, { width: 1700, height: 2200 }]) });
  });

  it('keeps marked regions that line up with the pages', () => {
    const document = {
      version: DOCUMENT_VERSION,
      pages: [
        { width: 1700, height: 2200, regionsComplete: true, blocks: [userBlock('r1', 'math', { x: 10, y: 20, width: 300, height: 40 })] },
        { width: 1700, height: 2200, regionsComplete: false, blocks: [] },
      ],
    };
    const decoded = decodeSavedScan(scan({ document }));
    expect(decoded?.document).toEqual(document);
    expect(decoded?.labelsUnreadable).toBeUndefined();
  });

  it('opens a scan without its labels when they do not line up, instead of dropping the scan', () => {
    const one = { width: 1700, height: 2200, regionsComplete: true, blocks: [] };
    for (const document of [
      { version: DOCUMENT_VERSION, pages: [one] },
      { version: DOCUMENT_VERSION, pages: [one, { ...one, width: 1600 }] },
      { version: DOCUMENT_VERSION + 1, pages: [one, one] },
      'labels',
    ]) {
      const decoded = decodeSavedScan(scan({ document }));
      expect(decoded?.labelsUnreadable).toBe(true);
      expect(decoded?.document.pages.map((p) => p.blocks.length)).toEqual([0, 0]);
    }
  });

  it('files a scan saved before courses existed under no course', () => {
    const { course: _course, ...older } = scan();
    expect(decodeSavedScan(older)?.course).toBe('');
    expect(decodeSavedScan(scan({ course: 12 }))?.course).toBe('');
  });

  it('drops records that would break the library list', () => {
    for (const bad of [
      null, 3, 'scan', {},
      scan({ id: 7 }),
      scan({ title: undefined }),
      scan({ createdAt: null }),
      scan({ pages: 'two' }),
      scan({ pages: [] }),
      scan({ pages: [page(), null] }),
      scan({ pages: [{ ...page(), jpeg: 'not a blob' }] }),
      scan({ pages: [{ ...page(), width: 0 }] }),
      scan({ pages: [{ ...page(), height: Number.NaN }] }),
    ]) expect(decodeSavedScan(bad)).toBeNull();
  });
});

describe('groupByCourse', () => {
  const filed = (id: string, course: string) => scan({ id, course }) as SavedScan;

  it('orders courses alphabetically, numbers by value, and unfiled scans last', () => {
    const groups = groupByCourse([filed('a', ''), filed('b', 'MATH 20C'), filed('c', 'CSE 100'), filed('d', 'CSE 12')]);
    expect(groups.map((g) => g.course)).toEqual(['CSE 12', 'CSE 100', 'MATH 20C', '']);
  });

  it('treats courses that differ only in case or spaces as one, keeping the first spelling and the order', () => {
    const groups = groupByCourse([filed('a', 'Chem 6A'), filed('b', ' chem 6a '), filed('c', 'CHEM 6A')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].course).toBe('Chem 6A');
    expect(groups[0].scans.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns nothing for no scans', () => {
    expect(groupByCourse([])).toEqual([]);
  });
});

describe('scanFileName', () => {
  it('turns spaces into hyphens and drops characters file systems reject', () => {
    expect(scanFileName('Week 4 lecture')).toBe('Week-4-lecture.pdf');
    expect(scanFileName('  CS 30: proofs / induction?  ')).toBe('CS-30-proofs-induction.pdf');
  });

  it('keeps letters from any script', () => {
    expect(scanFileName('محاضرة 4')).toBe('محاضرة-4.pdf');
    expect(scanFileName('Ökonomie Übung')).toBe('Ökonomie-Übung.pdf');
  });

  it('falls back to notes when nothing usable is left', () => {
    expect(scanFileName('')).toBe('notes.pdf');
    expect(scanFileName('???')).toBe('notes.pdf');
  });
});

describe('moving a page between scans', () => {
  const box = { x: 10, y: 20, width: 300, height: 40 };
  const now = new Date('2026-10-24T04:00:00.000Z');
  const saved = (id: string, blockIds: string[][]): SavedScan => {
    const pages = blockIds.map(() => page());
    return {
      id, title: id, course: '', createdAt: '2026-10-23T06:00:00.000Z', pages,
      document: {
        version: DOCUMENT_VERSION,
        pages: blockIds.map((ids) => ({ width: 1700, height: 2200, regionsComplete: false, blocks: ids.map((i) => userBlock(i, 'text', box)) })),
      },
    };
  };

  it('adds the page at the end with its regions, and stamps the time', () => {
    const target = saved('t', [['a']]);
    const moved = page();
    const labels = { width: 1700, height: 2200, regionsComplete: true, blocks: [{ ...userBlock('b', 'math', box), content: 'x^2' }] };
    const result = withPageAdded(target, moved, labels, now);
    expect(result.pages).toEqual([target.pages[0], moved]);
    expect(result.document.pages[1]).toEqual(labels);
    expect(result.createdAt).toBe(now.toISOString());
    expect(decodeSavedScan(result)?.document).toEqual(result.document);
  });

  it('gives a moved region a new id when the scan already uses its id, so decoding keeps it', () => {
    const target = saved('t', [['a', 'b']]);
    const ids = ['b', 'c'];
    const labels = { width: 1700, height: 2200, regionsComplete: false, blocks: [userBlock('a', 'text', box), userBlock('z', 'text', box)] };
    const result = withPageAdded(target, page(), labels, now, () => ids.shift()!);
    expect(result.document.pages[1].blocks.map((b) => b.id)).toEqual(['c', 'z']);
    expect(decodeSavedScan(result)?.document.pages[1].blocks).toHaveLength(2);
  });

  it('removes the page and its regions together, so they stay lined up', () => {
    const source = saved('s', [['a'], ['b'], ['c']]);
    const result = withPageRemoved(source, 1, now);
    expect(result.pages).toEqual([source.pages[0], source.pages[2]]);
    expect(result.document.pages.map((p) => p.blocks[0].id)).toEqual(['a', 'c']);
    expect(result.createdAt).toBe(now.toISOString());
    expect(source.pages).toHaveLength(3);
  });
});
