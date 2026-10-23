/** Every localStorage key the app writes starts with this, except the theme. */
export const STORAGE_PREFIX = 'sahurlock.';
export const THEME_STORAGE_KEY = 'sahurlock-theme';
/** IndexedDB database that holds uploaded punishment videos. */
export const VIDEO_DATABASE = 'sahurlock';
/** IndexedDB database that holds scans saved from the Scan tool. */
export const SCAN_DATABASE = 'sahurlock-scans';

/** What the user authored or chose, keyed by the name it gets in an export file. */
const EXPORTED_KEYS: Record<string, string> = {
  settings:        'sahurlock.settings',
  sessions:        'sahurlock.history',
  aggregate:       'sahurlock.aggregate',
  tasks:           'sahurlock.tasks',
  notes:           'sahurlock.notes',
  flashcards:      'sahurlock.flashcards',
  templates:       'sahurlock.templates',
  goals:           'sahurlock.goals',
  schedule:        'sahurlock.schedule',
  customVideo:     'sahurlock.custom_video',
};

/** All keys this app owns in a Storage, including Spotify tokens and UI state. */
export function appStorageKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && (key.startsWith(STORAGE_PREFIX) || key === THEME_STORAGE_KEY)) keys.push(key);
  }
  return keys;
}

/**
 * The user's data as one JSON-ready object. Spotify tokens are credentials and
 * the uploaded video is binary, so neither is included.
 */
export function collectExport(storage: Storage, now: Date): Record<string, unknown> {
  const data: Record<string, unknown> = { exportedAt: now.toISOString() };
  for (const [name, key] of Object.entries(EXPORTED_KEYS)) {
    const raw = storage.getItem(key);
    if (raw === null) continue;
    try { data[name] = JSON.parse(raw); } catch { data[name] = raw; }
  }
  return data;
}

/** Remove every key this app owns. Returns how many were removed. */
export function clearAppStorage(storage: Storage): number {
  const keys = appStorageKeys(storage);
  keys.forEach((key) => storage.removeItem(key));
  return keys.length;
}

/** Delete an IndexedDB database. Resolves even if another tab holds it open. */
function deleteDatabase(idb: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = idb.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** Delete every IndexedDB database the app owns: uploaded videos and saved scans. */
export const deleteAppDatabases = (idb: IDBFactory) =>
  Promise.all([VIDEO_DATABASE, SCAN_DATABASE].map((name) => deleteDatabase(idb, name))).then(() => undefined);
