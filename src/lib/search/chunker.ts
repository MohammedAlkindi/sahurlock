import type { ChunkOptions, DocumentPageInput, TextChunk } from '@/lib/types';

const SENTENCE_ENDINGS = new Set(['.', '!', '?', '."', '!"', '?"']);
const DEFAULT_CHUNK_SIZE = 400; // words
const DEFAULT_OVERLAP = 100; // words
const DEFAULT_LOOKAHEAD = 50; // words to scan forward for a sentence boundary

export interface ChunkDocumentMeta {
  documentId?: string;
  title?: string;
  course?: string;
}

/**
 * Split document pages into overlapping word-window chunks with sentence boundary awareness.
 * Faithfully ports Folio's chunking engine to TypeScript with zero external dependencies.
 *
 * - chunk_size and overlap are in words.
 * - page_number is the page containing the majority of words in the chunk; ties broken by higher page number.
 * - page_start / page_end record the exact boundaries.
 */
export function chunkPages(
  pages: DocumentPageInput[],
  options?: ChunkOptions,
  meta?: ChunkDocumentMeta,
): TextChunk[] {
  if (!pages || pages.length === 0) {
    return [];
  }

  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options?.overlap ?? DEFAULT_OVERLAP;
  const maxLookahead = options?.maxLookahead ?? DEFAULT_LOOKAHEAD;

  const documentId = meta?.documentId ?? '';
  const title = meta?.title ?? 'Untitled';
  const course = meta?.course ?? '';

  // Flatten all words with parallel page-number markers
  const words: string[] = [];
  const wordPages: number[] = [];

  for (const page of pages) {
    const pageWords = page.text.trim().split(/\s+/).filter((w) => w.length > 0);
    for (const w of pageWords) {
      words.push(w);
      wordPages.push(page.pageNumber);
    }
  }

  if (words.length === 0) {
    return [];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  const total = words.length;

  while (start < total) {
    let end = Math.min(start + chunkSize, total);

    // Try to extend end to the next sentence boundary within lookahead
    if (end < total) {
      for (let offset = 0; offset < maxLookahead; offset++) {
        const probe = end + offset;
        if (probe >= total) {
          end = total;
          break;
        }
        const w = words[probe];
        const hasEnding = Array.from(SENTENCE_ENDINGS).some((p) => w.endsWith(p));
        if (hasEnding) {
          end = probe + 1;
          break;
        }
      }
    }

    const chunkWords = words.slice(start, end);
    const chunkText = chunkWords.join(' ');
    const pageSlice = wordPages.slice(start, end);

    // Count page frequencies in this chunk slice
    const counts = new Map<number, number>();
    for (const p of pageSlice) {
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }

    let maxCount = 0;
    for (const count of counts.values()) {
      if (count > maxCount) maxCount = count;
    }

    // Among pages tied for most words, pick the highest page number (Folio rule)
    let majorityPage = pageSlice[0] ?? 1;
    let highestTiedPage = -Infinity;
    for (const [p, count] of counts.entries()) {
      if (count === maxCount && p > highestTiedPage) {
        highestTiedPage = p;
        majorityPage = p;
      }
    }

    const chunkIndex = chunks.length;
    const chunkId = documentId ? `${documentId}-chunk-${chunkIndex}` : `chunk-${chunkIndex}`;

    chunks.push({
      id: chunkId,
      documentId,
      title,
      course,
      text: chunkText,
      pageNumber: majorityPage,
      pageStart: wordPages[start] ?? null,
      pageEnd: wordPages[end - 1] ?? null,
      chunkIndex,
    });

    if (end >= total) {
      break;
    }

    let nextStart = end - overlap;
    if (nextStart <= start) {
      nextStart = start + 1;
    }
    start = nextStart;
  }

  return chunks;
}
