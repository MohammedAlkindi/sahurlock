import type { SearchResult, TextChunk } from '@/lib/types';

/**
 * Tokenize string into lowercase alphanumeric words, stripping punctuation.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

export interface BM25Options {
  k1?: number; // term frequency saturation parameter (default 1.5)
  b?: number; // document length normalization parameter (default 0.75)
}

/**
 * BM25Okapi search index ported from Folio's retrieval layer.
 * Operates client-side with zero network calls and deterministic scoring.
 */
export class BM25Index {
  private chunks: TextChunk[];
  private docLengths: number[];
  private avgDocLength: number;
  private docFreqs: Map<string, number>;
  private termFreqs: Map<string, number>[];
  private k1: number;
  private b: number;

  constructor(chunks: TextChunk[], options?: BM25Options) {
    this.chunks = chunks;
    this.k1 = options?.k1 ?? 1.5;
    this.b = options?.b ?? 0.75;
    this.docLengths = [];
    this.docFreqs = new Map();
    this.termFreqs = [];

    let totalLength = 0;

    for (let i = 0; i < chunks.length; i++) {
      const tokens = tokenize(chunks[i].text);
      const length = tokens.length;
      this.docLengths.push(length);
      totalLength += length;

      const tf = new Map<string, number>();
      const seen = new Set<string>();

      for (const token of tokens) {
        tf.set(token, (tf.get(token) ?? 0) + 1);
        if (!seen.has(token)) {
          seen.add(token);
          this.docFreqs.set(token, (this.docFreqs.get(token) ?? 0) + 1);
        }
      }
      this.termFreqs.push(tf);
    }

    this.avgDocLength = chunks.length > 0 ? totalLength / chunks.length : 0;
  }

  /**
   * Search query against the indexed chunks, returning top_k ranked results.
   */
  public search(query: string, topK = 10): SearchResult[] {
    const queryTokens = tokenize(query);
    if (this.chunks.length === 0 || queryTokens.length === 0) {
      return [];
    }

    const nDocs = this.chunks.length;
    const scores = new Float64Array(nDocs);

    for (const q of queryTokens) {
      const nq = this.docFreqs.get(q) ?? 0;
      if (nq === 0) continue;

      // Robertson-Sparck Jones IDF formula with + 1 smoothing (BM25Okapi)
      const idf = Math.log((nDocs - nq + 0.5) / (nq + 0.5) + 1.0);

      for (let i = 0; i < nDocs; i++) {
        const tf = this.termFreqs[i].get(q) ?? 0;
        if (tf === 0) continue;

        const docLen = this.docLengths[i];
        const lenNorm = 1.0 - this.b + this.b * (docLen / (this.avgDocLength || 1.0));
        const scoreTerm = idf * ((tf * (this.k1 + 1.0)) / (tf + this.k1 * lenNorm));
        scores[i] += scoreTerm;
      }
    }

    // Filter results that have non-zero match score
    const matches: { index: number; score: number }[] = [];
    let minScore = Infinity;
    let maxScore = -Infinity;

    for (let i = 0; i < nDocs; i++) {
      const score = scores[i];
      if (score > 0) {
        matches.push({ index: i, score });
        if (score < minScore) minScore = score;
        if (score > maxScore) maxScore = score;
      }
    }

    if (matches.length === 0) {
      return [];
    }

    // Sort descending by score
    matches.sort((a, b) => b.score - a.score);

    const scoreRange = maxScore - minScore;
    const topResults = matches.slice(0, topK);

    return topResults.map((m, rank) => {
      const normalised = scoreRange > 0 ? (m.score - minScore) / scoreRange : 1.0;
      // distance: 0 = best match, 1 = worst match
      const distance = 1.0 - normalised;

      return {
        chunk: this.chunks[m.index],
        score: m.score,
        distance,
        rank: rank + 1,
      };
    });
  }
}
