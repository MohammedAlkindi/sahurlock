import { describe, expect, it } from 'vitest';
import {
  buildCitationSources,
  buildGroundedContext,
  evaluateConfidence,
  extractExcerpt,
  formatInlineCitation,
} from './citation';
import type { SearchResult, TextChunk } from '@/lib/types';

describe('extractExcerpt', () => {
  it('preserves short text and cleans extra whitespace', () => {
    expect(extractExcerpt('   Short  text   ')).toBe('Short text');
  });

  it('truncates cleanly with ellipsis without cutting in the middle of words', () => {
    const long = 'The fundamental theorem of calculus provides a powerful method for evaluating definite integrals without Riemann sums.';
    const excerpt = extractExcerpt(long, 40);
    expect(excerpt.endsWith('...')).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(43);
  });
});

describe('evaluateConfidence', () => {
  it('returns insufficient_data for empty results', () => {
    expect(evaluateConfidence([])).toBe('insufficient_data');
  });

  it('rates confidence tiers accurately', () => {
    const chunk: TextChunk = {
      id: 'c1',
      documentId: 'd1',
      title: 'Doc',
      course: 'CS101',
      text: 'text',
      pageNumber: 1,
      pageStart: 1,
      pageEnd: 1,
      chunkIndex: 0,
    };

    const highRes: SearchResult[] = [{ chunk, score: 5, distance: 0.1 }];
    expect(evaluateConfidence(highRes)).toBe('high');

    const medRes: SearchResult[] = [{ chunk, score: 2, distance: 0.5 }];
    expect(evaluateConfidence(medRes)).toBe('medium');

    const lowRes: SearchResult[] = [{ chunk, score: 0.5, distance: 0.75 }];
    expect(evaluateConfidence(lowRes)).toBe('low');
  });
});

describe('formatInlineCitation', () => {
  it('formats title and page number', () => {
    expect(formatInlineCitation({ title: 'Physics Notes', pageNumber: 4 })).toBe(
      'Source: Physics Notes, p. 4',
    );
    expect(formatInlineCitation({ title: 'Physics Notes', pageNumber: null })).toBe(
      'Source: Physics Notes',
    );
  });
});

describe('buildGroundedContext', () => {
  it('constructs structured context block with citations and confidence tier', () => {
    const chunk: TextChunk = {
      id: 'c1',
      documentId: 'd1',
      title: 'Biology 101',
      course: 'BIO101',
      text: 'Mitochondria produce ATP through cellular respiration and oxidative phosphorylation.',
      pageNumber: 12,
      pageStart: 12,
      pageEnd: 12,
      chunkIndex: 0,
    };
    const results: SearchResult[] = [{ chunk, score: 4.5, distance: 0.15 }];

    const context = buildGroundedContext(results);
    expect(context.confidence).toBe('high');
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].pageNumber).toBe(12);
    expect(context.promptContext).toContain('[1] Biology 101 [BIO101] (p. 12)');
    expect(context.promptContext).toContain('Mitochondria produce ATP');
  });
});
