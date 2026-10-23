import { describe, expect, it } from 'vitest';
import { userBlock, withContent, withKind } from '@/lib/scan/document';
import { type KeyedPage, scanKey } from '@/lib/scan/scan-key';

const box = { x: 10, y: 20, width: 300, height: 40 };
const page = (overrides: Partial<KeyedPage> = {}): KeyedPage => ({
  url: 'blob:a', regionsComplete: false, blocks: [userBlock('r1', 'text', box)], ...overrides,
});
const key = (pages: KeyedPage[], title = 'Lecture 5', course = 'CSE 12') => scanKey(title, course, pages);

describe('scanKey', () => {
  const base = key([page(), page({ url: 'blob:b', blocks: [] })]);

  it('changes with the title, the course, and each page’s image', () => {
    expect(key([page(), page({ url: 'blob:b', blocks: [] })], 'Lecture 6')).not.toBe(base);
    expect(key([page(), page({ url: 'blob:b', blocks: [] })], 'Lecture 5', 'CSE 100')).not.toBe(base);
    expect(key([page({ url: 'blob:c' }), page({ url: 'blob:b', blocks: [] })])).not.toBe(base);
  });

  it('ignores spaces around the course, which a save trims', () => {
    expect(key([page(), page({ url: 'blob:b', blocks: [] })], 'Lecture 5', ' CSE 12 ')).toBe(base);
  });

  it('changes with the page order', () => {
    expect(key([page({ url: 'blob:b', blocks: [] }), page()])).not.toBe(base);
  });

  it('changes with any region edit and with marking a page complete', () => {
    const r = userBlock('r1', 'text', box);
    const edits = [
      [withKind(r, 'math')],
      [{ ...r, box: { ...box, x: 11 } }],
      [{ ...r, box: { ...box, width: 301 } }],
      [withContent(r, 'Kinematics')],
      [r, userBlock('r2', 'graph', box)],
      [],
    ];
    for (const blocks of edits) expect(key([page({ blocks }), page({ url: 'blob:b', blocks: [] })])).not.toBe(base);
    expect(key([page({ regionsComplete: true }), page({ url: 'blob:b', blocks: [] })])).not.toBe(base);
  });

  it('is the same for equal blocks built with their fields in another order', () => {
    const r = userBlock('r1', 'text', box);
    const shuffled = { reviewed: r.reviewed, origin: r.origin, tokens: r.tokens, content: r.content, box: { height: 40, width: 300, y: 20, x: 10 }, kind: r.kind, id: r.id };
    expect(key([page({ blocks: [shuffled] }), page({ url: 'blob:b', blocks: [] })])).toBe(base);
  });
});
