import { describe, expect, it } from 'vitest';
import { BM25Index, tokenize } from './bm25';
import type { TextChunk } from '@/lib/types';

describe('tokenize', () => {
  it('strips punctuation, trims whitespace, and converts to lowercase', () => {
    expect(tokenize('Hello, WORLD! 123...')).toEqual(['hello', 'world', '123']);
  });
});

describe('BM25Index', () => {
  const sampleChunks: TextChunk[] = [
    {
      id: 'c1',
      documentId: 'doc1',
      title: 'Calculus I',
      course: 'MATH101',
      text: 'The fundamental theorem of calculus connects differentiation and integration.',
      pageNumber: 1,
      pageStart: 1,
      pageEnd: 1,
      chunkIndex: 0,
    },
    {
      id: 'c2',
      documentId: 'doc1',
      title: 'Calculus I',
      course: 'MATH101',
      text: 'Derivatives represent instantaneous rates of change and slopes of curves.',
      pageNumber: 2,
      pageStart: 2,
      pageEnd: 2,
      chunkIndex: 1,
    },
    {
      id: 'c3',
      documentId: 'doc2',
      title: 'Organic Chemistry',
      course: 'CHEM201',
      text: 'Electrophilic aromatic substitution is an organic reaction where an electrophile replaces hydrogen.',
      pageNumber: 5,
      pageStart: 5,
      pageEnd: 5,
      chunkIndex: 0,
    },
  ];

  it('returns empty results on empty query or when index is empty', () => {
    const emptyIndex = new BM25Index([]);
    expect(emptyIndex.search('calculus')).toEqual([]);

    const index = new BM25Index(sampleChunks);
    expect(index.search('')).toEqual([]);
    expect(index.search('   ')).toEqual([]);
  });

  it('ranks relevant documents highest with distance in [0, 1]', () => {
    const index = new BM25Index(sampleChunks);
    const results = index.search('calculus differentiation');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunk.id).toBe('c1');
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].distance).toBeGreaterThanOrEqual(0);
    expect(results[0].distance).toBeLessThanOrEqual(1);
  });

  it('finds chemistry chunk when searching chemistry terms', () => {
    const index = new BM25Index(sampleChunks);
    const results = index.search('aromatic reaction');

    expect(results.length).toBe(1);
    expect(results[0].chunk.id).toBe('c3');
    expect(results[0].chunk.course).toBe('CHEM201');
  });
});
