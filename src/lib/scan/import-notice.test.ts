import { describe, expect, it } from 'vitest';
import { type ScanNotice, noticeAfterRead } from '@/lib/scan/import-notice';

const own: ScanNotice = { kind: 'reading', text: 'Reading a.pdf…' };
const truncated = 'a.pdf has more than 40 pages, so only the first 40 were added.';

describe('noticeAfterRead', () => {
  it("clears the read's own notice when nothing was left out", () => {
    expect(noticeAfterRead(own, own, null)).toBeNull();
  });

  it("keeps another read's notice, or an error, that took its place", () => {
    const other: ScanNotice = { kind: 'reading', text: 'Reading b.pdf…' };
    const error: ScanNotice = { kind: 'error', text: 'b.pdf could not be read as a PDF.' };
    expect(noticeAfterRead(other, own, null)).toBe(other);
    expect(noticeAfterRead(error, own, null)).toBe(error);
    expect(noticeAfterRead(null, own, null)).toBeNull();
  });

  it('always says when pages were left out, even after its notice was cleared or replaced', () => {
    expect(noticeAfterRead(own, own, truncated)).toEqual({ kind: 'info', text: truncated });
    expect(noticeAfterRead(null, own, truncated)).toEqual({ kind: 'info', text: truncated });
    expect(noticeAfterRead({ kind: 'reading', text: 'Reading b.pdf…' }, own, truncated)).toEqual({ kind: 'info', text: truncated });
  });

  it('adds the pages left out to an error showing, instead of hiding either', () => {
    const error: ScanNotice = { kind: 'error', text: 'b.pdf could not be read as a PDF.' };
    expect(noticeAfterRead(error, own, truncated)).toEqual({ kind: 'error', text: `${error.text} Also, ${truncated}` });
  });
});
