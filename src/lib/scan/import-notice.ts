/** The line at the top of the Scan page: a PDF being read, what came of an import or an open, or why one failed. */
export interface ScanNotice {
  kind: 'reading' | 'error' | 'info';
  text: string;
}

/**
 * The notice to show once a PDF read ends. Pages left out are always said,
 * after any error showing, so they are never left out without a word.
 * Otherwise only this read's own notice goes: another read's, or an error,
 * stays. `own` is compared by identity, so pass the very object this read set.
 */
export function noticeAfterRead(current: ScanNotice | null, own: ScanNotice, truncated: string | null): ScanNotice | null {
  if (truncated) return current?.kind === 'error' ? { kind: 'error', text: `${current.text} Also, ${truncated}` } : { kind: 'info', text: truncated };
  return current === own ? null : current;
}
