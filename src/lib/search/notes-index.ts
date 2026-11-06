import { readingOrder } from '@/lib/scan/reading-order';
import type { SavedScan } from '@/lib/scan/library';
import type { ChunkOptions, DocumentPageInput, Note, SearchResult, TextChunk } from '@/lib/types';
import { chunkPages } from './chunker';
import { BM25Index } from './bm25';

/**
 * Extract searchable text pages from a typed Note.
 */
export function extractNotePages(note: Note): DocumentPageInput[] {
  const content = `${note.title}\n\n${note.body}`.trim();
  if (!content) return [];
  return [{ pageNumber: 1, text: content }];
}

/**
 * Extract searchable text pages from a SavedScan's marked blocks and transcribed text in reading order.
 */
export function extractScanPages(scan: SavedScan): DocumentPageInput[] {
  if (!scan.document || !Array.isArray(scan.document.pages)) {
    return [];
  }

  const pages: DocumentPageInput[] = [];

  scan.document.pages.forEach((page, pIdx) => {
    const pageNumber = pIdx + 1;
    const sortedBlocks = readingOrder(page.blocks);
    const textParts: string[] = [];

    for (const block of sortedBlocks) {
      if (block.content && block.content.trim().length > 0) {
        textParts.push(block.content.trim());
      }
    }

    if (textParts.length > 0) {
      pages.push({
        pageNumber,
        text: textParts.join('\n\n'),
      });
    }
  });

  return pages;
}

export interface BuildNotesIndexOptions {
  notes?: Note[];
  scans?: SavedScan[];
  chunkOptions?: ChunkOptions;
}

/**
 * Ingest and chunk all typed notes and scanned handwritten documents into a unified BM25 index.
 */
export function buildNotesIndex(options: BuildNotesIndexOptions): {
  index: BM25Index;
  chunks: TextChunk[];
} {
  const allChunks: TextChunk[] = [];
  const chunkOptions = options.chunkOptions;

  if (options.notes) {
    for (const note of options.notes) {
      const pages = extractNotePages(note);
      if (pages.length === 0) continue;
      const chunks = chunkPages(pages, chunkOptions, {
        documentId: note.id,
        title: note.title || 'Untitled Note',
        course: '',
      });
      allChunks.push(...chunks);
    }
  }

  if (options.scans) {
    for (const scan of options.scans) {
      const pages = extractScanPages(scan);
      if (pages.length === 0) continue;
      const chunks = chunkPages(pages, chunkOptions, {
        documentId: scan.id,
        title: scan.title || 'Untitled Scan',
        course: scan.course || '',
      });
      allChunks.push(...chunks);
    }
  }

  const index = new BM25Index(allChunks);
  return { index, chunks: allChunks };
}

export interface SearchNotesOptions {
  topK?: number;
  course?: string;
}

/**
 * Search across indexed notes and scans, with optional course filtering.
 */
export function searchNotes(
  index: BM25Index,
  query: string,
  options?: SearchNotesOptions,
): SearchResult[] {
  const topK = options?.topK ?? 10;
  const courseFilter = options?.course?.trim().toLowerCase();

  // If course filter is applied, request a larger pool first then filter
  const poolSize = courseFilter ? topK * 3 : topK;
  const results = index.search(query, poolSize);

  if (!courseFilter) {
    return results.slice(0, topK);
  }

  return results
    .filter((r) => r.chunk.course.toLowerCase() === courseFilter)
    .slice(0, topK);
}
