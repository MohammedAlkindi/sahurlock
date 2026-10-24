/** A line at the top of the Scan page: what came of an import, an open, a download or a save. */
export interface ScanNotice {
  kind: 'error' | 'info';
  text: string;
}

/** How a notice is announced: an error interrupts, other news waits its turn. */
export const urgencyOf = (notice: ScanNotice): 'polite' | 'assertive' => (notice.kind === 'error' ? 'assertive' : 'polite');

/** The PDFs being read into one set of pages, by name, in the order they started. */
export interface Reads {
  set: number;
  names: string[];
}

/** `reads` with a read of `name` begun for page set `set`. Reads for an older set are dropped, as their pages will be. */
export const startRead = (reads: Reads, set: number, name: string): Reads =>
  ({ set, names: reads.set === set ? [...reads.names, name] : [name] });

/** `reads` with one read of `name` for page set `set` ended. A read for an older set changes nothing. */
export function endRead(reads: Reads, set: number, name: string): Reads {
  if (reads.set !== set) return reads;
  const at = reads.names.indexOf(name);
  return at < 0 ? reads : { set, names: reads.names.filter((_, i) => i !== at) };
}

/** The status line for reads in progress, or null with none, such as "Reading a.pdf and b.pdf…". */
export function readingLine(names: string[]): string | null {
  if (names.length === 0) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Reading ${list}…`;
}
