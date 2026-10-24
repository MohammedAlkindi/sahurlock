import { describe, expect, it } from 'vitest';
import { endRead, readingLine, type Reads, startRead } from '@/lib/scan/imports';

describe('reads in progress', () => {
  it('adds and ends reads by name, one at a time, so two reads of one name both count', () => {
    let reads: Reads = { set: 1, names: [] };
    reads = startRead(reads, 1, 'a.pdf');
    reads = startRead(reads, 1, 'b.pdf');
    reads = startRead(reads, 1, 'a.pdf');
    expect(reads.names).toEqual(['a.pdf', 'b.pdf', 'a.pdf']);
    reads = endRead(reads, 1, 'a.pdf');
    expect(reads.names).toEqual(['b.pdf', 'a.pdf']);
    expect(endRead(reads, 1, 'missing.pdf')).toBe(reads);
  });

  it('drops reads for pages that were replaced, and ignores them when they end', () => {
    const old: Reads = { set: 1, names: ['a.pdf'] };
    expect(startRead(old, 2, 'b.pdf')).toEqual({ set: 2, names: ['b.pdf'] });
    const now: Reads = { set: 2, names: ['b.pdf'] };
    expect(endRead(now, 1, 'a.pdf')).toBe(now);
  });

  it('names every PDF being read', () => {
    expect(readingLine([])).toBeNull();
    expect(readingLine(['a.pdf'])).toBe('Reading a.pdf…');
    expect(readingLine(['a.pdf', 'b.pdf'])).toBe('Reading a.pdf and b.pdf…');
    expect(readingLine(['a.pdf', 'b.pdf', 'c.pdf'])).toBe('Reading a.pdf, b.pdf and c.pdf…');
  });
});
