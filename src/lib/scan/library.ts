import { SCAN_DATABASE } from '@/lib/data-management';
import { decodeDocument, type DocumentPage, emptyDocument, type ScanDocument } from '@/lib/scan/document';
import { uid } from '@/lib/utils';

// Saved scans live in their own IndexedDB database on this device. Nothing is
// uploaded, and Settings > Data > Clear all data deletes the database.

const STORE = 'scans';
/**
 * Version 2 added marked regions. Bump this whenever DOCUMENT_VERSION changes:
 * code that predates the change then gets a VersionError instead of opening the
 * database and saving over labels it cannot read.
 */
const DB_VERSION = 2;

/** One cleaned page. The JPEG is what the PDF embeds, so it is all that is kept. */
export interface SavedPage {
  jpeg: Blob;
  width: number;
  height: number;
}

export interface SavedScan {
  id: string;
  title: string;
  /** The course it is filed under. Empty when it is not filed. */
  course: string;
  /** ISO time it was last saved. */
  createdAt: string;
  pages: SavedPage[];
  /** Regions marked on each page, lined up with `pages` by position. */
  document: ScanDocument;
  /** Set when stored labels could not be read, so the scan was opened without them. Never stored. */
  labelsUnreadable?: true;
}

const isSize = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** A stored record as a scan, or null when it is not one (an older shape, or damage). */
export function decodeSavedScan(value: unknown): SavedScan | null {
  const s = value as Partial<SavedScan> | null;
  if (typeof s?.id !== 'string' || typeof s.title !== 'string' || typeof s.createdAt !== 'string') return null;
  if (!Array.isArray(s.pages) || s.pages.length === 0) return null;
  const pagesOk = s.pages.every((p: Partial<SavedPage> | null) => p?.jpeg instanceof Blob && isSize(p.width) && isSize(p.height));
  if (!pagesOk) return null;
  const pages = s.pages;
  // Scans saved before courses or regions existed have none.
  const scan: SavedScan = {
    id: s.id, title: s.title, course: typeof s.course === 'string' ? s.course : '', createdAt: s.createdAt, pages,
    document: emptyDocument(pages.map(({ width, height }) => ({ width, height }))),
  };
  if (s.document === undefined) return scan;
  // Labels count only if they line up with the pages. Otherwise the scan opens without them.
  const document = decodeDocument(s.document);
  const fits = document !== null && document.pages.length === pages.length
    && document.pages.every((p, i) => p.width === pages[i].width && p.height === pages[i].height);
  return fits ? { ...scan, document } : { ...scan, labelsUnreadable: true };
}

export interface CourseGroup {
  course: string;
  scans: SavedScan[];
}

/**
 * Scans grouped by course, courses in alphabetical order and unfiled scans last.
 * Courses that differ only in case or surrounding spaces are one course, shown
 * as first spelled. Within a group the input order is kept.
 */
export function groupByCourse(scans: SavedScan[]): CourseGroup[] {
  const groups = new Map<string, CourseGroup>();
  for (const scan of scans) {
    const course = scan.course.trim();
    const key = course.toLocaleLowerCase();
    const group = groups.get(key) ?? { course, scans: [] };
    group.scans.push(scan);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.course || !b.course) return a.course ? -1 : b.course ? 1 : 0;
    return a.course.localeCompare(b.course, undefined, { sensitivity: 'base', numeric: true });
  });
}

/**
 * The scan with a page added at the end, with its marked regions. A region
 * whose id the scan already uses gets a new one, since ids are unique across
 * a scan's document. `now` becomes its saved time.
 */
export function withPageAdded(scan: SavedScan, page: SavedPage, labels: DocumentPage, now: Date, newId: () => string = uid): SavedScan {
  const taken = new Set(scan.document.pages.flatMap((p) => p.blocks.map((b) => b.id)));
  const blocks = labels.blocks.map((block) => {
    let id = block.id;
    while (taken.has(id)) id = newId();
    taken.add(id);
    return id === block.id ? block : { ...block, id };
  });
  return {
    ...scan,
    createdAt: now.toISOString(),
    pages: [...scan.pages, page],
    document: { ...scan.document, pages: [...scan.document.pages, { ...labels, width: page.width, height: page.height, blocks }] },
  };
}

/** The scan without the page at `position`, and its regions. `now` becomes its saved time. */
export function withPageRemoved(scan: SavedScan, position: number, now: Date): SavedScan {
  return {
    ...scan,
    createdAt: now.toISOString(),
    pages: scan.pages.filter((_, i) => i !== position),
    document: { ...scan.document, pages: scan.document.pages.filter((_, i) => i !== position) },
  };
}

/** A download name from a scan's title: letters and digits in any script, spaces as hyphens. */
export function scanFileName(title: string): string {
  const stem = title.replace(/[^\p{L}\p{N}\- ]+/gu, '').trim().replace(/\s+/g, '-');
  return `${stem || 'notes'}.pdf`;
}

function open(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb.open(SCAN_DATABASE, DB_VERSION);
    request.onupgradeneeded = () => {
      // Upgrading from version 1 keeps its store and records as they are.
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(idb: IDBFactory, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open(idb);
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? request.error);
      tx.onabort = () => reject(tx.error ?? request.error);
    });
  } finally {
    db.close();
  }
}

/** Add a scan, or replace the one with the same id. */
export const saveScan = (idb: IDBFactory, scan: SavedScan) => run(idb, 'readwrite', (s) => s.put(scan)).then(() => undefined);

export const deleteScan = (idb: IDBFactory, id: string) => run(idb, 'readwrite', (s) => s.delete(id)).then(() => undefined);

/**
 * The page to move: one of a saved scan's pages, or a page that is not saved
 * anywhere yet. For a saved scan the caller gives the saved time and page
 * sizes of the copy it holds, so a scan saved again since, in another tab or
 * window, is refused. Every save stamps a new time, so pages reordered there
 * are caught even when they are all one size.
 */
export type MoveSource =
  | { scanId: string; position: number; savedAt: string; sizes: { width: number; height: number }[] }
  | { page: SavedPage; labels: DocumentPage };

/**
 * A scan the move needed is gone, changed since it was opened, or has labels
 * that cannot be read. Nothing was written. `scan` says which: the target, the
 * source changed, or the source gone.
 */
export class ScanChangedError extends Error {
  constructor(readonly scan: 'source' | 'source-gone' | 'target', reason: string) {
    super(reason);
  }
}

export interface MoveResult {
  target: SavedScan;
  /** The source scan as it is now, or null when it was not saved or its last page left, which deletes it. */
  source: SavedScan | null;
}

/**
 * Move a page, with its marked regions, to the end of another saved scan.
 * Both scans are read and written in one transaction, so a failure changes
 * neither. A target whose labels cannot be read is refused, since writing it
 * would replace those labels with none.
 */
export async function movePageToScan(idb: IDBFactory, source: MoveSource, targetId: string, now: Date): Promise<MoveResult> {
  const db = await open(idb);
  try {
    return await new Promise<MoveResult>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      let result: MoveResult | null = null;
      let refused: ScanChangedError | null = null;
      const refuse = (scan: ScanChangedError['scan'], reason: string) => {
        refused = new ScanChangedError(scan, reason);
        tx.abort();
      };
      tx.oncomplete = () => resolve(result!);
      tx.onabort = () => reject(refused ?? tx.error);

      const write = (target: SavedScan, from: { scan: SavedScan; position: number } | null, page: SavedPage, labels: DocumentPage) => {
        const moved = withPageAdded(target, page, labels, now);
        store.put(moved);
        let rest: SavedScan | null = null;
        if (from) {
          rest = withPageRemoved(from.scan, from.position, now);
          if (rest.pages.length > 0) store.put(rest);
          else {
            store.delete(rest.id);
            rest = null;
          }
        }
        result = { target: moved, source: rest };
      };

      // The source is read first: when it is gone the open pages are saved nowhere, which
      // matters more than anything about the target, and is reported even if both are gone.
      const withSource = (next: (from: SavedScan | null) => void) => {
        if ('page' in source) return next(null);
        const sourceRequest = store.get(source.scanId);
        sourceRequest.onsuccess = () => {
          if (sourceRequest.result === undefined) return refuse('source-gone', 'the scan the page is in is gone');
          const from = decodeSavedScan(sourceRequest.result);
          const same = from !== null && from.createdAt === source.savedAt && from.pages.length === source.sizes.length
            && from.pages.every((p, i) => p.width === source.sizes[i].width && p.height === source.sizes[i].height);
          if (!from || !same) return refuse('source', 'the scan the page is in has changed since it was opened');
          next(from);
        };
      };

      withSource((from) => {
        if (!('page' in source) && source.scanId === targetId) return refuse('target', 'a page cannot move to its own scan');
        const targetRequest = store.get(targetId);
        targetRequest.onsuccess = () => {
          const target = decodeSavedScan(targetRequest.result);
          if (!target) return refuse('target', 'the scan to move to is gone');
          if (target.labelsUnreadable) return refuse('target', 'the scan to move to has labels that cannot be read');
          if ('page' in source) return write(target, null, source.page, source.labels);
          write(target, { scan: from!, position: source.position }, from!.pages[source.position], from!.document.pages[source.position]);
        };
      });
    });
  } finally {
    db.close();
  }
}

/** Every saved scan, newest first. Records that are not a scan are skipped. */
export async function listScans(idb: IDBFactory): Promise<SavedScan[]> {
  const all = await run<unknown[]>(idb, 'readonly', (s) => s.getAll());
  return all
    .map(decodeSavedScan)
    .filter((scan): scan is SavedScan => scan !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
