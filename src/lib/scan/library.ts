import { SCAN_DATABASE } from '@/lib/data-management';

// Saved scans live in their own IndexedDB database on this device. Nothing is
// uploaded, and Settings > Data > Clear all data deletes the database.

const STORE = 'scans';

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
}

const isSize = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** A stored record as a scan, or null when it is not one (an older shape, or damage). */
export function decodeSavedScan(value: unknown): SavedScan | null {
  const s = value as Partial<SavedScan> | null;
  if (typeof s?.id !== 'string' || typeof s.title !== 'string' || typeof s.createdAt !== 'string') return null;
  if (!Array.isArray(s.pages) || s.pages.length === 0) return null;
  const pagesOk = s.pages.every((p: Partial<SavedPage> | null) => p?.jpeg instanceof Blob && isSize(p.width) && isSize(p.height));
  if (!pagesOk) return null;
  // Scans saved before courses existed have none.
  return { id: s.id, title: s.title, course: typeof s.course === 'string' ? s.course : '', createdAt: s.createdAt, pages: s.pages };
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

/** A download name from a scan's title: letters and digits in any script, spaces as hyphens. */
export function scanFileName(title: string): string {
  const stem = title.replace(/[^\p{L}\p{N}\- ]+/gu, '').trim().replace(/\s+/g, '-');
  return `${stem || 'notes'}.pdf`;
}

function open(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb.open(SCAN_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
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

/** Every saved scan, newest first. Records that are not a scan are skipped. */
export async function listScans(idb: IDBFactory): Promise<SavedScan[]> {
  const all = await run<unknown[]>(idb, 'readonly', (s) => s.getAll());
  return all
    .map(decodeSavedScan)
    .filter((scan): scan is SavedScan => scan !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
