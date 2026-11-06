import { describe, expect, it } from 'vitest';
import { chunkPages } from './chunker';

describe('chunkPages', () => {
  it('returns empty array on empty input or empty pages', () => {
    expect(chunkPages([])).toEqual([]);
    expect(chunkPages([{ pageNumber: 1, text: '   ' }])).toEqual([]);
  });

  it('chunks short text into a single chunk with correct majority page', () => {
    const pages = [
      { pageNumber: 1, text: 'First page text. Simple sentence.' },
    ];
    const chunks = chunkPages(pages, { chunkSize: 50, overlap: 10 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].pageNumber).toBe(1);
    expect(chunks[0].pageStart).toBe(1);
    expect(chunks[0].pageEnd).toBe(1);
    expect(chunks[0].text).toBe('First page text. Simple sentence.');
  });

  it('respects sentence boundaries within lookahead', () => {
    // 5 words, ending in period, followed by more words
    const words1 = 'word one word two word three.';
    const words2 = 'word four word five.';
    const pages = [{ pageNumber: 1, text: `${words1} ${words2}` }];

    // If chunkSize=4, it should look ahead and finish at 'three.' (offset 2 within lookahead)
    const chunks = chunkPages(pages, { chunkSize: 4, overlap: 1, maxLookahead: 5 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].text.endsWith('.')).toBe(true);
  });

  it('correctly calculates majority page and breaks ties with higher page number', () => {
    const pages = [
      { pageNumber: 1, text: 'Alpha bravo charlie' }, // 3 words
      { pageNumber: 2, text: 'Delta echo foxtrot golf' }, // 4 words
    ];
    const chunks = chunkPages(pages, { chunkSize: 10, overlap: 2 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].pageNumber).toBe(2); // Page 2 has 4 words vs Page 1 has 3 words
  });

  it('breaks page ties by picking the higher page number (Folio invariant)', () => {
    const pages = [
      { pageNumber: 1, text: 'One two three' }, // 3 words
      { pageNumber: 2, text: 'Four five six' }, // 3 words
    ];
    const chunks = chunkPages(pages, { chunkSize: 10, overlap: 2 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].pageNumber).toBe(2);
  });

  it('creates multiple overlapping chunks for long documents and guarantees progress', () => {
    const sampleWords = Array.from({ length: 100 }, (_, i) => `word${i}`);
    const pages = [{ pageNumber: 1, text: sampleWords.join(' ') }];
    const chunks = chunkPages(pages, { chunkSize: 20, overlap: 5 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[1].chunkIndex).toBe(1);
  });
});
