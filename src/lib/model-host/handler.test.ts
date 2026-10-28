import * as ort from 'onnxruntime-web';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHandler } from './handler';
import { tinyAddModel } from './test-model';
import type { ByteStore, HostDeps, ModelPin } from './types';
import { parseManifest, sha256Hex, storeKey } from './verify';

/** A ByteStore in memory, standing in for Cache Storage. */
function memoryStore(): ByteStore & { map: Map<string, Uint8Array<ArrayBuffer>> } {
  const map = new Map<string, Uint8Array<ArrayBuffer>>();
  return {
    map,
    get: async (key) => map.get(key) ?? null,
    put: async (key, bytes) => { map.set(key, bytes); },
    delete: async (key) => { map.delete(key); },
    keys: async () => [...map.keys()],
    clear: async () => { map.clear(); },
  };
}

const MANIFEST_KEY = '/models/manifest.json?saved';
/** Stands in for the runtime's .wasm, which the host keeps when the manifest changes. */
const RUNTIME_KEY = '/vendor/onnxruntime-web/1.30.0/ort.wasm?sha256=0';

let pin: ModelPin;
beforeAll(async () => {
  ort.env.wasm.numThreads = 1;
  const bytes = tinyAddModel();
  pin = { name: 'tiny-add', version: '1', url: `/models/tiny-add.onnx`, sha256: await sha256Hex(bytes), size: bytes.byteLength };
});

/** A host whose network serves the manifest and the given model bytes. */
function host(model: Uint8Array<ArrayBuffer>, store: ByteStore = memoryStore(), manifest = () => Response.json({ schema: 1, models: [pin] })) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
    String(input) === '/models/manifest.json' ? manifest() : new Response(model));
  const startRuntime = vi.fn<HostDeps['startRuntime']>(async () => ({ ort, backend: 'wasm' }));
  const handle = createHandler({ fetch, store, manifestUrl: '/models/manifest.json', keep: [RUNTIME_KEY], startRuntime });
  return { handle, fetch, store, startRuntime };
}

const offline = () => Promise.reject(new TypeError('Failed to fetch'));

describe('model host', () => {
  it('loads the pinned model and runs it', async () => {
    const { handle } = host(tinyAddModel());
    expect(await handle({ id: '1', type: 'load', model: 'tiny-add' })).toMatchObject({
      ok: true, model: { name: 'tiny-add', backend: 'wasm', source: 'network', inputNames: ['x'], outputNames: ['y'] },
    });
    const ran = await handle({ id: '2', type: 'run', model: 'tiny-add', feeds: { x: { dims: [3], data: new Float32Array([10, 20, 30]) } } });
    expect(ran.ok && ran.type === 'ran' && Array.from(ran.outputs.y.data)).toEqual([11, 22, 33]);
  });

  it('refuses a model whose SHA-256 does not match, before ONNX Runtime starts', async () => {
    const swapped = tinyAddModel({ producerVersion: '2' });
    expect(swapped.byteLength).toBe(pin.size); // same size, so only the hash can catch it
    const store = memoryStore();
    const { handle, startRuntime } = host(swapped, store);
    const create = vi.spyOn(ort.InferenceSession, 'create');
    expect(await handle({ id: '1', type: 'load', model: 'tiny-add' })).toMatchObject({ ok: false, error: { code: 'sha256' } });
    expect(startRuntime).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(store.map.size).toBe(0);
    create.mockRestore();
  });

  it('refuses a model longer or shorter than its pin, and saves nothing', async () => {
    for (const wrong of [tinyAddModel({ bias: [1, 2, 3, 4] }), tinyAddModel().slice(0, pin.size - 1)]) {
      const store = memoryStore();
      const { handle, startRuntime } = host(wrong, store);
      expect(await handle({ id: '1', type: 'load', model: 'tiny-add' })).toMatchObject({ ok: false, error: { code: 'size' } });
      expect(startRuntime).not.toHaveBeenCalled();
      expect(store.map.size).toBe(0);
    }
  });

  it('says the site answered with an error, not that the network is gone', async () => {
    const { handle, fetch } = host(tinyAddModel());
    fetch.mockImplementation(async (input) =>
      String(input) === '/models/manifest.json' ? Response.json({ schema: 1, models: [pin] }) : new Response('missing', { status: 404 }));
    expect(await handle({ id: '1', type: 'load', model: 'tiny-add' })).toMatchObject({ ok: false, error: { code: 'download', message: expect.stringContaining('404') } });
  });

  it('loads from the device when the network is gone', async () => {
    const { handle, fetch, store } = host(tinyAddModel());
    await handle({ id: '1', type: 'load', model: 'tiny-add' });
    fetch.mockImplementation(offline);
    expect(await handle({ id: '2', type: 'load', model: 'tiny-add' })).toMatchObject({ ok: true, model: { source: 'cache' } });
    expect(await store.keys()).toContain(storeKey(pin));
  });

  it('deletes a saved copy that no longer matches and fetches it again', async () => {
    const store = memoryStore();
    await store.put(storeKey(pin), tinyAddModel({ producerVersion: '2' }));
    const { handle, fetch } = host(tinyAddModel(), store);
    expect(await handle({ id: '1', type: 'load', model: 'tiny-add' })).toMatchObject({ ok: true, model: { source: 'network' } });
    expect(fetch).toHaveBeenCalledWith(pin.url, expect.anything());
  });

  it('deletes a saved copy that no longer matches even when it cannot fetch a new one', async () => {
    const store = memoryStore();
    await store.put(MANIFEST_KEY, new TextEncoder().encode(JSON.stringify({ schema: 1, models: [pin] })));
    await store.put(storeKey(pin), tinyAddModel({ producerVersion: '2' }));
    const { handle, fetch, startRuntime } = host(tinyAddModel(), store);
    fetch.mockImplementation(offline);
    expect(await handle({ id: '1', type: 'load', model: 'tiny-add' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(store.map.has(storeKey(pin))).toBe(false);
    expect(startRuntime).not.toHaveBeenCalled();
  });

  it('tries to start the runtime again after a start that failed', async () => {
    const { handle, startRuntime } = host(tinyAddModel());
    startRuntime.mockRejectedValueOnce(new Error('the .wasm answered 503'));
    expect(await handle({ id: '1', type: 'load', model: 'tiny-add' })).toMatchObject({
      ok: false, error: { code: 'runtime', message: 'ONNX Runtime could not start: the .wasm answered 503' },
    });
    expect(await handle({ id: '2', type: 'load', model: 'tiny-add' })).toMatchObject({ ok: true });
    expect(startRuntime).toHaveBeenCalledTimes(2);
  });

  it('still loads a model when the device refuses to save it', async () => {
    const full: ByteStore = {
      get: async () => { throw new DOMException('blocked', 'SecurityError'); },
      put: async () => { throw new DOMException('full', 'QuotaExceededError'); },
      delete: async () => {},
      keys: async () => { throw new DOMException('blocked', 'SecurityError'); },
      clear: async () => {},
    };
    const { handle } = host(tinyAddModel(), full);
    expect(await handle({ id: '1', type: 'list' })).toMatchObject({ ok: true, models: [{ name: 'tiny-add', cached: false }] });
    expect(await handle({ id: '2', type: 'load', model: 'tiny-add' })).toMatchObject({ ok: true, model: { source: 'network', saved: false } });
  });

  it('stops reading a download as soon as it runs past its pinned size', async () => {
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(pin.size + 1)); },
      pull: () => new Promise(() => {}), // never sends the rest
      cancel() { cancelled = true; },
    });
    const { handle, fetch } = host(tinyAddModel());
    fetch.mockImplementation(async (input) =>
      String(input) === '/models/manifest.json' ? Response.json({ schema: 1, models: [pin] }) : new Response(endless));
    expect(await handle({ id: '1', type: 'load', model: 'tiny-add' })).toMatchObject({ ok: false, error: { code: 'size' } });
    expect(cancelled).toBe(true);
  }, 2000);

  it('falls back to the saved manifest when offline or the site fails, but not when the site says it is gone', async () => {
    const answers: Record<string, () => Promise<Response>> = {
      offline,
      503: async () => new Response('busy', { status: 503 }),
      404: async () => new Response('gone', { status: 404 }),
    };
    for (const [name, answer] of Object.entries(answers)) {
      const { handle, fetch } = host(tinyAddModel());
      await handle({ id: '1', type: 'load', model: 'tiny-add' });
      fetch.mockImplementation(answer);
      expect(await handle({ id: '2', type: 'load', model: 'tiny-add' }), name).toMatchObject(
        name === '404' ? { ok: false, error: { code: 'download' } } : { ok: true, model: { source: 'cache' } },
      );
    }
  });

  it('reports a bad manifest even when an older one is saved', async () => {
    const { handle, fetch } = host(tinyAddModel());
    await handle({ id: '1', type: 'load', model: 'tiny-add' });
    fetch.mockImplementation(async () => new Response('<!doctype html>'));
    expect(await handle({ id: '2', type: 'list' })).toMatchObject({ ok: false, error: { code: 'bad-manifest' } });
  });

  it('answers one request at a time, so a list cannot be undone by a load still running', async () => {
    let manifests = 0;
    const { handle, fetch, store } = host(tinyAddModel());
    fetch.mockImplementation(async (input) => {
      if (String(input) !== '/models/manifest.json') {
        await new Promise((resolve) => setTimeout(resolve, 20)); // a slow download
        return new Response(tinyAddModel());
      }
      // The first fetch pins the model. By the second, a release has withdrawn it.
      return Response.json({ schema: 1, models: manifests++ === 0 ? [pin] : [] });
    });
    const [loaded, listed] = await Promise.all([handle({ id: '1', type: 'load', model: 'tiny-add' }), handle({ id: '2', type: 'list' })]);
    expect(loaded).toMatchObject({ ok: true });
    expect(listed).toMatchObject({ ok: true, models: [] });
    expect(await store.keys()).toEqual([]);
  });

  it('lists the pinned models and saves nothing until one loads', async () => {
    const { handle, store } = host(tinyAddModel());
    expect(await handle({ id: '1', type: 'list' })).toMatchObject({ ok: true, models: [{ name: 'tiny-add', cached: false }] });
    expect(await store.keys()).toEqual([]);
    expect(await handle({ id: '2', type: 'load', model: 'tiny-add' })).toMatchObject({ ok: true, model: { saved: true } });
    expect(await handle({ id: '3', type: 'list' })).toMatchObject({ ok: true, models: [{ name: 'tiny-add', cached: true }] });
  });

  it('forgets a model the manifest no longer pins, so it stops loading offline too', async () => {
    const other = { ...pin, name: 'other', url: '/models/other.onnx', sha256: 'b'.repeat(64) };
    let pinned = [pin, other];
    const { handle, fetch, store } = host(tinyAddModel(), memoryStore(), () => Response.json({ schema: 1, models: pinned }));
    await handle({ id: '1', type: 'load', model: 'tiny-add' });
    await store.put(RUNTIME_KEY, new Uint8Array([1]));
    await store.put(storeKey(other), new Uint8Array([1]));
    pinned = [other];
    expect(await handle({ id: '2', type: 'list' })).toMatchObject({ ok: true, models: [{ name: 'other' }] });
    expect((await store.keys()).sort()).toEqual([MANIFEST_KEY, storeKey(other), RUNTIME_KEY].sort());
    fetch.mockImplementation(offline);
    expect(await handle({ id: '3', type: 'load', model: 'tiny-add' })).toMatchObject({ ok: false, error: { code: 'unknown-model' } });
  });

  it('deletes everything, the runtime too, once the manifest pins nothing', async () => {
    let pinned = [pin];
    const { handle, store } = host(tinyAddModel(), memoryStore(), () => Response.json({ schema: 1, models: pinned }));
    await handle({ id: '1', type: 'load', model: 'tiny-add' });
    await store.put(RUNTIME_KEY, new Uint8Array([1]));
    pinned = [];
    expect(await handle({ id: '2', type: 'list' })).toMatchObject({ ok: true, models: [] });
    expect(await store.keys()).toEqual([]);
  });

  it('reports a manifest that is not JSON, or not in the expected form', async () => {
    for (const manifest of [() => new Response('<!doctype html>'), () => Response.json({ schema: 2, models: [] })]) {
      const { handle } = host(tinyAddModel(), memoryStore(), manifest);
      expect(await handle({ id: '1', type: 'load', model: 'tiny-add' })).toMatchObject({ ok: false, error: { code: 'bad-manifest' } });
    }
  });

  it('answers a model that is not pinned with a normalised error', async () => {
    const { handle } = host(tinyAddModel());
    expect(await handle({ id: '1', type: 'load', model: 'nope' })).toMatchObject({ ok: false, error: { code: 'unknown-model' } });
    expect(await handle({ id: '2', type: 'run', model: 'nope', feeds: {} })).toMatchObject({ ok: false, error: { code: 'not-loaded' } });
  });
});

describe('parseManifest', () => {
  it('rejects entries that are not same-origin model files or lack a full hash', () => {
    const entry = { name: 'a', version: '1', url: '/models/a.onnx', sha256: 'a'.repeat(64), size: 1 };
    expect(parseManifest({ schema: 1, models: [entry] }).models).toHaveLength(1);
    for (const url of ['https://huggingface.co/a.onnx', '/models/../a.onnx', '/models/./a.onnx', '/models/layout detector.onnx', '/models/é.onnx', '/models/a.onnx?v=1', '/models/sub/a.onnx']) {
      expect(() => parseManifest({ schema: 1, models: [{ ...entry, url }] }), url).toThrow();
    }
    expect(() => parseManifest({ schema: 1, models: [{ ...entry, sha256: 'abc' }] })).toThrow();
    expect(() => parseManifest({ schema: 2, models: [] })).toThrow();
  });
});
