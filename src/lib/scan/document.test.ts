import { describe, expect, it } from 'vitest';
import {
  type Block, BLOCK_KINDS, decodeDocument, DOCUMENT_VERSION, emptyDocument, isReadKind, needsReview, userBlock, withContent, withKind,
} from '@/lib/scan/document';

const block = (overrides: Record<string, unknown> = {}): Block => ({
  id: 'b1',
  kind: 'text',
  box: { x: 100, y: 200, width: 600, height: 80 },
  content: 'Newton’s second law',
  tokens: [
    { text: 'Newton’s', confidence: 0.94, alternatives: [{ text: 'Newtons', confidence: 0.04 }] },
    { text: 'second', confidence: 0.97, alternatives: [] },
    { text: 'law', confidence: 0.99, alternatives: [] },
  ],
  origin: { by: 'model', model: 'trocr-small-handwritten', version: '0.1.0' },
  reviewed: false,
  ...overrides,
} as Block);

const doc = (blocks: unknown[], regionsComplete = false) => ({ version: DOCUMENT_VERSION, pages: [{ width: 1700, height: 2200, regionsComplete, blocks }] });

describe('decodeDocument', () => {
  it('keeps a well-formed document as it is', () => {
    const value = doc([block(), block({ id: 'b2', kind: 'math', content: 'F = ma', origin: { by: 'user' } })], true);
    expect(decodeDocument(value)).toEqual(value);
  });

  it('counts a page as completely marked only when it says so', () => {
    for (const flag of [undefined, 'yes', 1, null, false]) {
      const value = { version: DOCUMENT_VERSION, pages: [{ width: 1700, height: 2200, regionsComplete: flag, blocks: [] }] };
      expect(decodeDocument(value)?.pages[0].regionsComplete).toBe(false);
    }
    expect(decodeDocument(doc([], true))?.pages[0].regionsComplete).toBe(true);
  });

  it('keeps a block nothing has read yet', () => {
    const value = doc([block({ kind: 'diagram', content: null, tokens: [], origin: { by: 'user' } })]);
    expect(decodeDocument(value)?.pages[0].blocks).toHaveLength(1);
  });

  it('refuses a version it does not know rather than guess at it', () => {
    expect(decodeDocument({ ...doc([block()]), version: 2 })).toBeNull();
    expect(decodeDocument({ pages: [] })).toBeNull();
    for (const bad of [null, 'doc', [], { version: 1 }]) expect(decodeDocument(bad)).toBeNull();
  });

  it('refuses the whole document when a page is malformed, since pages line up by position', () => {
    expect(decodeDocument({ version: DOCUMENT_VERSION, pages: [{ width: 0, height: 10, blocks: [] }] })).toBeNull();
    expect(decodeDocument({ version: DOCUMENT_VERSION, pages: ['page'] })).toBeNull();
  });

  it('drops a bad block and keeps the rest', () => {
    const good = block({ id: 'ok' });
    const bad = [
      block({ id: '' }),
      block({ id: 'kind', kind: 'doodle' }),
      block({ id: 'outside', box: { x: 1600, y: 0, width: 200, height: 50 } }),
      block({ id: 'negative', box: { x: -1, y: 0, width: 10, height: 10 } }),
      block({ id: 'flat', box: { x: 0, y: 0, width: 10, height: 0 } }),
      block({ id: 'confidence', tokens: [{ text: 'x', confidence: 1.2, alternatives: [] }] }),
      block({ id: 'alternative', tokens: [{ text: 'x', confidence: 0.5, alternatives: [{ text: 'y' }] }] }),
      block({ id: 'origin', origin: { by: 'model', model: 'm' } }),
      block({ id: 'content', content: 42 }),
      block({ id: 'reviewed', reviewed: 'yes' }),
      block({ id: 'tokens', tokens: null }),
      'not a block',
    ];
    const decoded = decodeDocument(doc([...bad, good]));
    expect(decoded?.pages[0].blocks.map((b) => b.id)).toEqual(['ok']);
  });

  it('keeps the first of two blocks that share an id, even across pages', () => {
    const value = {
      version: DOCUMENT_VERSION,
      pages: [
        { width: 1700, height: 2200, regionsComplete: false, blocks: [block({ id: 'same', content: 'first' })] },
        { width: 1700, height: 2200, regionsComplete: false, blocks: [block({ id: 'same', content: 'second' })] },
      ],
    };
    const decoded = decodeDocument(value)!;
    expect(decoded.pages[0].blocks[0].content).toBe('first');
    expect(decoded.pages[1].blocks).toEqual([]);
  });

  it('allows a box that touches the page edge', () => {
    const edge = block({ box: { x: 0, y: 0, width: 1700, height: 2200 } });
    expect(decodeDocument(doc([edge]))?.pages[0].blocks).toHaveLength(1);
  });
});

describe('needsReview', () => {
  it('flags a block with a token below the threshold', () => {
    expect(needsReview(block())).toBe(false);
    const unsure = block({ tokens: [{ text: 'Newfon', confidence: 0.41, alternatives: [{ text: 'Newton', confidence: 0.38 }] }] });
    expect(needsReview(unsure)).toBe(true);
    expect(needsReview(unsure, 0.4)).toBe(false);
  });

  it('flags text, headings and math that nothing has read, but not crops kept as images', () => {
    for (const kind of ['text', 'heading', 'math'] as const) expect(needsReview(block({ kind, content: null, tokens: [] }))).toBe(true);
    for (const kind of ['table', 'graph', 'diagram'] as const) expect(needsReview(block({ kind, content: null, tokens: [] }))).toBe(false);
  });

  it('never flags a block the user has reviewed', () => {
    expect(needsReview(block({ content: null, tokens: [], reviewed: true }))).toBe(false);
  });
});

describe('BLOCK_KINDS', () => {
  it('keeps its order, because training data numbers kinds by position', () => {
    expect(BLOCK_KINDS).toEqual(['text', 'heading', 'math', 'table', 'graph', 'diagram']);
    expect(BLOCK_KINDS.filter(isReadKind)).toEqual(['text', 'heading', 'math']);
  });
});

describe('editing user regions', () => {
  const box = { x: 10, y: 20, width: 300, height: 40 };

  it('starts a drawn region as the user’s, reviewed, with nothing typed', () => {
    const b = userBlock('r1', 'math', box);
    expect(b).toEqual({ id: 'r1', kind: 'math', box, content: null, tokens: [], origin: { by: 'user' }, reviewed: true });
    expect(needsReview(b)).toBe(false);
    expect(decodeDocument(doc([b]))?.pages[0].blocks).toEqual([b]);
  });

  it('keeps typed text between read kinds and drops it for kinds kept as images', () => {
    const typed = withContent(userBlock('r1', 'text', box), 'Kinematics');
    expect(withKind(typed, 'heading').content).toBe('Kinematics');
    for (const kind of ['table', 'graph', 'diagram'] as const) {
      expect(withKind(typed, kind)).toMatchObject({ kind, content: null, tokens: [] });
    }
  });

  it('trims what is typed, clears blanks, and makes recognized content the user’s', () => {
    const predicted = block({ kind: 'math', content: 'F = rna', reviewed: false });
    const fixed = withContent(predicted, '  F = ma \n');
    expect(fixed).toMatchObject({ content: 'F = ma', tokens: [], origin: { by: 'user' }, reviewed: true });
    expect(withContent(fixed, '   ').content).toBeNull();
    expect(withContent(userBlock('r2', 'graph', box), 'axes')).toEqual(userBlock('r2', 'graph', box));
  });
});

describe('emptyDocument', () => {
  it('has one empty page per size, which decodes back to itself', () => {
    const empty = emptyDocument([{ width: 1700, height: 2200 }, { width: 2200, height: 1700 }]);
    expect(empty.pages.map((p) => [p.width, p.height, p.blocks.length, p.regionsComplete])).toEqual([[1700, 2200, 0, false], [2200, 1700, 0, false]]);
    expect(decodeDocument(JSON.parse(JSON.stringify(empty)))).toEqual(empty);
  });
});
