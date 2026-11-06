import type { SearchResult } from '@/lib/types';

/**
 * Merge multiple ranked result lists using Reciprocal Rank Fusion (RRF).
 * Ported from Folio's retrieval/fusion.py.
 *
 * Formula: score(d) = sum_over_lists( 1 / (k + rank(d, list)) )
 * Default k = 60.
 */
export function reciprocalRankFusion(
  rankedLists: SearchResult[][],
  k = 60,
): SearchResult[] {
  if (!rankedLists || rankedLists.length === 0) {
    return [];
  }

  const scores = new Map<string, number>();
  const merged = new Map<string, SearchResult>();

  for (const list of rankedLists) {
    for (let i = 0; i < list.length; i++) {
      const result = list[i];
      const chunk = result.chunk;
      const key = chunk.id || `${chunk.documentId}-${chunk.chunkIndex}`;
      const rank = i + 1;

      const currentScore = scores.get(key) ?? 0;
      scores.set(key, currentScore + 1.0 / (k + rank));

      if (!merged.has(key)) {
        merged.set(key, result);
      }
    }
  }

  const sortedKeys = Array.from(scores.keys()).sort((a, b) => {
    return (scores.get(b) ?? 0) - (scores.get(a) ?? 0);
  });

  return sortedKeys.map((key, index) => {
    const item = merged.get(key)!;
    const rrfScore = scores.get(key) ?? 0;

    return {
      ...item,
      score: rrfScore,
      rank: index + 1,
    };
  });
}
