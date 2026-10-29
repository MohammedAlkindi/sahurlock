/**
 * The Document JSON for scanned notes: what is on each cleaned page, as blocks
 * with a box, a kind, the content read from it and how sure the reader was.
 *
 * Boxes come from the user drawing them or from a region detector, content
 * from a recognizer or the user typing it. A block nothing has read keeps
 * `content: null`, so the page shows its crop instead of a guess.
 *
 * This is version 1. A later version adds a migration to `decodeDocument`, so
 * stored labels are never silently reinterpreted.
 *
 * Training data numbers kinds by their place in BLOCK_KINDS plus one (text is 1,
 * diagram is 6), so kinds are only ever added at the end, never reordered.
 */

export const DOCUMENT_VERSION = 1;

export const BLOCK_KINDS = ['text', 'heading', 'math', 'table', 'graph', 'diagram'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

/** Kinds whose content is read as text or LaTeX. Tables, graphs and diagrams are kept as crops for now. */
const READ_KINDS: readonly BlockKind[] = ['text', 'heading', 'math'];

export const isReadKind = (kind: BlockKind) => READ_KINDS.includes(kind);

/** A rectangle in the cleaned page's pixels, measured from its top-left corner. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Alternative {
  text: string;
  /** 0 to 1. */
  confidence: number;
}

/** One recognized unit, such as a word or a LaTeX token. */
export interface Token {
  text: string;
  /** 0 to 1. */
  confidence: number;
  alternatives: Alternative[];
}

/** Who decided a block's box, kind and content. */
export type Origin = { by: 'user' } | { by: 'model'; model: string; version: string };

export interface Block {
  /** Unique within its document. */
  id: string;
  kind: BlockKind;
  box: Box;
  /** Text for text and heading blocks, LaTeX for math. Null until something has read it. */
  content: string | null;
  /** The recognizer's tokens for `content`, empty when the user typed it or nothing has read it. */
  tokens: Token[];
  origin: Origin;
  /** Set once the user has checked or corrected the block. */
  reviewed: boolean;
}

export interface DocumentPage {
  /** The cleaned page's size in pixels, which every box is measured against. */
  width: number;
  height: number;
  /** Set when the user says every region on the page is marked, so a detector can learn from what is not marked too. */
  regionsComplete: boolean;
  /** In the order they were marked. readingOrder in reading-order.ts gives the order to read them in. */
  blocks: Block[];
}

export interface ScanDocument {
  version: typeof DOCUMENT_VERSION;
  pages: DocumentPage[];
}

/** A document for pages of these sizes, with nothing marked on them yet. */
export const emptyDocument = (sizes: { width: number; height: number }[]): ScanDocument => ({
  version: DOCUMENT_VERSION,
  pages: sizes.map(({ width, height }) => ({ width, height, regionsComplete: false, blocks: [] })),
});

/** A region the user has just drawn: nothing typed in it yet, and theirs, so already reviewed. */
export const userBlock = (id: string, kind: BlockKind, box: Box): Block => ({
  id, kind, box, content: null, tokens: [], origin: { by: 'user' }, reviewed: true,
});

/** The block as another kind. A kind kept as an image has no content, so anything typed is dropped. */
export const withKind = (block: Block, kind: BlockKind): Block =>
  isReadKind(kind) ? { ...block, kind } : { ...block, kind, content: null, tokens: [] };

/**
 * The block with what the user typed for it, trimmed. Typing makes the content
 * theirs: the recognizer's tokens go and the block counts as reviewed. Blank
 * text clears it. Kinds kept as images take no content.
 */
export function withContent(block: Block, text: string): Block {
  if (!isReadKind(block.kind)) return block;
  const content = text.trim() || null;
  return { ...block, content, tokens: [], origin: { by: 'user' }, reviewed: true };
}

/** Below this a token counts as unsure. To be calibrated on held-out pages once a recognizer exists. */
export const REVIEW_CONFIDENCE = 0.8;

/**
 * Whether the user should look at a block before trusting it: one that should
 * have been read but was not, or one with any token the recognizer was unsure
 * of. A block the user has reviewed is never flagged again.
 */
export function needsReview(block: Block, threshold = REVIEW_CONFIDENCE): boolean {
  if (block.reviewed || !isReadKind(block.kind)) return false;
  return block.content === null || block.tokens.some((t) => t.confidence < threshold);
}

type Fields = Record<string, unknown>;

const record = (v: unknown): Fields | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Fields) : null;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const unit = (v: unknown): v is number => finite(v) && v >= 0 && v <= 1;
const positive = (v: unknown): v is number => finite(v) && v > 0;

function decodeBox(value: unknown, page: { width: number; height: number }): Box | null {
  const b = record(value);
  if (!b || !finite(b.x) || !finite(b.y) || !positive(b.width) || !positive(b.height)) return null;
  const inside = b.x >= 0 && b.y >= 0 && b.x + b.width <= page.width && b.y + b.height <= page.height;
  return inside ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
}

function decodeAlternative(value: unknown): Alternative | null {
  const a = record(value);
  return a && typeof a.text === 'string' && unit(a.confidence) ? { text: a.text, confidence: a.confidence } : null;
}

function decodeToken(value: unknown): Token | null {
  const t = record(value);
  if (!t || typeof t.text !== 'string' || !unit(t.confidence) || !Array.isArray(t.alternatives)) return null;
  const alternatives = t.alternatives.map(decodeAlternative);
  if (alternatives.some((a) => a === null)) return null;
  return { text: t.text, confidence: t.confidence, alternatives: alternatives as Alternative[] };
}

function decodeOrigin(value: unknown): Origin | null {
  const o = record(value);
  if (o?.by === 'user') return { by: 'user' };
  if (o?.by === 'model' && typeof o.model === 'string' && typeof o.version === 'string') {
    return { by: 'model', model: o.model, version: o.version };
  }
  return null;
}

function decodeBlock(value: unknown, page: { width: number; height: number }): Block | null {
  const b = record(value);
  if (!b || typeof b.id !== 'string' || !b.id) return null;
  const kind = BLOCK_KINDS.find((k) => k === b.kind);
  const box = decodeBox(b.box, page);
  const origin = decodeOrigin(b.origin);
  if (!kind || !box || !origin || typeof b.reviewed !== 'boolean') return null;
  if (b.content !== null && typeof b.content !== 'string') return null;
  if (!Array.isArray(b.tokens)) return null;
  const tokens = b.tokens.map(decodeToken);
  if (tokens.some((t) => t === null)) return null;
  return { id: b.id, kind, box, content: b.content, tokens: tokens as Token[], origin, reviewed: b.reviewed };
}

/**
 * A stored document, or null when it is not one or comes from a version this
 * code does not know. A block that is malformed, outside its page, or reuses
 * an earlier block's id is dropped, so one bad block never hides the rest. A
 * malformed page makes the whole document null instead, because pages line up
 * with the scan's pages by position.
 */
export function decodeDocument(value: unknown): ScanDocument | null {
  const d = record(value);
  if (!d || d.version !== DOCUMENT_VERSION || !Array.isArray(d.pages)) return null;
  const seen = new Set<string>();
  const pages: DocumentPage[] = [];
  for (const raw of d.pages) {
    const p = record(raw);
    if (!p || !positive(p.width) || !positive(p.height)) return null;
    const size = { width: p.width, height: p.height };
    const blocks: Block[] = [];
    for (const item of Array.isArray(p.blocks) ? p.blocks : []) {
      const block = decodeBlock(item, size);
      if (!block || seen.has(block.id)) continue;
      seen.add(block.id);
      blocks.push(block);
    }
    pages.push({ ...size, regionsComplete: p.regionsComplete === true, blocks });
  }
  return { version: DOCUMENT_VERSION, pages };
}
