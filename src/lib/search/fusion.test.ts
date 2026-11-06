import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from './fusion';
import type { SearchResult, TextChunk } from '@/lib/types';

describe('reciprocalRankFusion', () => {
  const makeChunk = (id: string, text: string): TextChunk => ({
    id,
    documentId: id,
    title: `Title ${id}`,
    course: 'COURSE',
    text,
    pageNumber: 1,
    pageStart: 1,
    pageEnd: 1,
    chunkIndex: 0,
  });

  it('handles empty input', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[]])).toEqual([]);
  });

  it('fuses two ranked lists and deduplicates items', () => {
    const listA: SearchResult[] = [
      { chunk: makeChunk('doc1', 'text 1'), score: 10, distance: 0 },
      { chunk: makeChunk('doc2', 'text 2'), score: 5, distance: 0.5 },
    ];
    const listB: SearchResult[] = [
      { chunk: makeChunk('doc2', 'text 2'), score: 8, distance: 0.2 },
      { chunk: makeChunk('doc3', 'text 3'), score: 4, distance: 0.6 },
    ];

    const fused = reciprocalRankFusion([listA, listB], 60);

    // doc2 appeared in both lists at rank 2 and rank 1:
    // score(doc2) = 1/(60+2) + 1/(60+1) = 1/62 + 1/61 = 0.016129 + 0.016393 = ~0.0325
    // score(doc1) = 1/(60+1) = ~0.01639
    // score(doc3) = 1/(60+2) = ~0.01612
    // doc2 should be ranked 1!
    expect(fused).toHaveLength(3);
    expect(fused[0].chunk.id).toBe('doc2');
    expect(fused[0].rank).toBe(1);
    expect(fused[1].chunk.id).toBe('doc1');
    expect(fused[2].chunk.id).toBe('doc3');
  });
});
