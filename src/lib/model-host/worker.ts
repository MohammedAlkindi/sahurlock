import { createHandler } from './handler';
import { RUNTIME_WASM, startBrowserRuntime } from './runtime';
import { cacheStore } from './store';
import type { ModelHostRequest, ModelHostResponse } from './types';
import { storeKey } from './verify';

// Runs ONNX Runtime off the main thread. Every file it loads comes from this app's origin.

const handle = createHandler({
  // Bound: a bare fetch called as a property of another object throws "Illegal invocation".
  fetch: fetch.bind(globalThis),
  // Cache Storage exists only on HTTPS and localhost.
  store: typeof caches === 'undefined' ? null : cacheStore(caches),
  manifestUrl: '/models/manifest.json',
  keep: [storeKey(RUNTIME_WASM)],
  startRuntime: startBrowserRuntime,
});

const reply = (response: ModelHostResponse) => self.postMessage(response);

self.onmessage = async (event: MessageEvent<ModelHostRequest>) => reply(await handle(event.data));
