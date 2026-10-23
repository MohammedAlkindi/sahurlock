import type { Block } from '@/lib/scan/document';

/** What a save stores about one page, as far as telling saved from unsaved goes. */
export interface KeyedPage {
  /** The cleaned image's object URL. Each clean makes a new one, so this stands in for the image. */
  url: string;
  regionsComplete: boolean;
  blocks: Block[];
}

const blockKey = (b: Block) => [
  b.id, b.kind, b.box.x, b.box.y, b.box.width, b.box.height, b.content, b.reviewed,
  b.origin.by, b.origin.by === 'model' ? b.origin.model : '', b.origin.by === 'model' ? b.origin.version : '',
  b.tokens.map((t) => [t.text, t.confidence]),
];

/**
 * A key for everything a save would store: the title, the course, and each
 * page's image and regions in order. The Scan page compares it with the key
 * from the last save to tell "Saved" from "Save changes". Fields are listed
 * one by one, so two equal blocks built in a different field order agree.
 */
export const scanKey = (title: string, course: string, pages: KeyedPage[]) =>
  JSON.stringify([title, course.trim(), pages.map((p) => [p.url, p.regionsComplete, p.blocks.map(blockKey)])]);
