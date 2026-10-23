import { describe, expect, it } from 'vitest';
import { type Block, decodeDocument, DOCUMENT_VERSION, emptyDocument, needsReview } from '@/lib/scan/document';

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

const doc = (blocks: unknown[]) => ({ version: DOCUMENT_VERSION, pages: [{ width: 1700, height: 2200, blocks }] });

describe('decodeDocument', () => {
  it('keeps a well-formed document as it is', () => {
    const value = doc([block(), block({ id: 'b2', kind: 'math', content: 'F = ma', origin: { by: 'user' } })]);
    expect(decodeDocument(value)).toEqual(value);
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
        { width: 1700, height: 2200, blocks: [block({ id: 'same', content: 'first' })] },
        { width: 1700, height: 2200, blocks: [block({ id: 'same', content: 'second' })] },
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

describe('emptyDocument', () => {
  it('has one empty page per size, which decodes back to itself', () => {
    const empty = emptyDocument([{ width: 1700, height: 2200 }, { width: 2200, height: 1700 }]);
    expect(empty.pages.map((p) => [p.width, p.height, p.blocks.length])).toEqual([[1700, 2200, 0], [2200, 1700, 0]]);
    expect(decodeDocument(JSON.parse(JSON.stringify(empty)))).toEqual(empty);
  });
});
