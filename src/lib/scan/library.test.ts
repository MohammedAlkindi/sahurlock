import { describe, expect, it } from 'vitest';
import { decodeSavedScan, scanFileName } from '@/lib/scan/library';

const page = () => ({ jpeg: new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' }), width: 1700, height: 2200 });
const scan = (overrides: Record<string, unknown> = {}) => ({
  id: 's1', title: 'Week 4 lecture', createdAt: '2026-10-23T06:00:00.000Z', pages: [page(), page()], ...overrides,
});

describe('decodeSavedScan', () => {
  it('keeps a well-formed scan', () => {
    const value = scan();
    expect(decodeSavedScan(value)).toEqual(value);
  });

  it('drops records that would break the library list', () => {
    for (const bad of [
      null, 3, 'scan', {},
      scan({ id: 7 }),
      scan({ title: undefined }),
      scan({ createdAt: null }),
      scan({ pages: 'two' }),
      scan({ pages: [] }),
      scan({ pages: [page(), null] }),
      scan({ pages: [{ ...page(), jpeg: 'not a blob' }] }),
      scan({ pages: [{ ...page(), width: 0 }] }),
      scan({ pages: [{ ...page(), height: Number.NaN }] }),
    ]) expect(decodeSavedScan(bad)).toBeNull();
  });
});

describe('scanFileName', () => {
  it('turns spaces into hyphens and drops characters file systems reject', () => {
    expect(scanFileName('Week 4 lecture')).toBe('Week-4-lecture.pdf');
    expect(scanFileName('  CS 30: proofs / induction?  ')).toBe('CS-30-proofs-induction.pdf');
  });

  it('keeps letters from any script', () => {
    expect(scanFileName('محاضرة 4')).toBe('محاضرة-4.pdf');
    expect(scanFileName('Ökonomie Übung')).toBe('Ökonomie-Übung.pdf');
  });

  it('falls back to notes when nothing usable is left', () => {
    expect(scanFileName('')).toBe('notes.pdf');
    expect(scanFileName('???')).toBe('notes.pdf');
  });
});
