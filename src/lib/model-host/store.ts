import { MODEL_CACHE } from '@/lib/data-management';
import type { ByteStore } from './types';

/**
 * A ByteStore over one Cache Storage cache. Keys are same-origin paths with a query. Only put
 * creates the cache, so a visit that saves nothing leaves nothing behind.
 */
export function cacheStore(storage: CacheStorage, name = MODEL_CACHE): ByteStore {
  return {
    async get(key) {
      const hit = await storage.match(key, { cacheName: name });
      return hit ? new Uint8Array(await hit.arrayBuffer()) : null;
    },
    async put(key, bytes) {
      await (await storage.open(name)).put(key, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }));
    },
    async delete(key) {
      if (await storage.has(name)) await (await storage.open(name)).delete(key);
    },
    async clear() {
      await storage.delete(name);
    },
    async keys() {
      if (!(await storage.has(name))) return [];
      return (await (await storage.open(name)).keys()).map((request) => {
        const url = new URL(request.url);
        return url.pathname + url.search;
      });
    },
  };
}

/** The same store, with every failure (storage full, or Cache Storage turned off) read as a miss. */
export function bestEffort(store: ByteStore): ByteStore {
  return {
    get: (key) => store.get(key).catch(() => null),
    put: (key, bytes) => store.put(key, bytes).catch(() => undefined),
    delete: (key) => store.delete(key).catch(() => undefined),
    keys: () => store.keys().catch(() => []),
    clear: () => store.clear().catch(() => undefined),
  };
}
