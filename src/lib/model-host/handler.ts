import type * as Ort from 'onnxruntime-web/webgpu';
import { bestEffort } from './store';
import type {
  Backend, Float32Payload, HostDeps, ModelHostError, ModelHostRequest, ModelHostResponse, ModelManifest, ModelPin, OrtModule, Runtime,
} from './types';
import { DownloadError, IntegrityError, ManifestError, parseManifest, storeKey, UnavailableError, verifiedBytes } from './verify';

const MANIFEST_KEY = '/models/manifest.json?saved';

/** ONNX Runtime's level for errors. Its warnings, such as an unused weight in a converted model, would only fill the console. */
const ERRORS_ONLY = 3;

/** ONNX Runtime did not start, for example because its own file could not be fetched or failed its check. */
class RuntimeStartError extends Error {
  constructor(cause: unknown) {
    super(`ONNX Runtime could not start: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'RuntimeStartError';
  }
}

function toError(e: unknown): ModelHostError {
  if (e instanceof IntegrityError) return { code: e.code, message: e.message };
  if (e instanceof UnavailableError) return { code: 'unavailable', message: e.message };
  if (e instanceof DownloadError) return { code: 'download', message: e.message };
  if (e instanceof ManifestError) return { code: 'bad-manifest', message: e.message };
  return { code: 'runtime', message: e instanceof Error ? e.message : String(e) };
}

const encode = (manifest: ModelManifest) => new TextEncoder().encode(JSON.stringify(manifest));

/** Builds the worker's message handler. Every failure comes back as a ModelHostError, never a throw. */
export function createHandler(deps: HostDeps) {
  // Saving is never what stops a model loading: a full disk or blocked storage reads as a miss.
  const store = deps.store && bestEffort(deps.store);
  let runtime: Promise<Runtime> | null = null;
  const sessions = new Map<string, { pin: ModelPin; session: Ort.InferenceSession }>();

  /**
   * Brings the device in line with a manifest just fetched: its copy is replaced, and saved files
   * it no longer pins are deleted, so a withdrawn model stops loading offline too. Skipped while
   * nothing is saved, so a visit that loads no model saves nothing.
   */
  async function refresh(fresh: ModelManifest) {
    const saved = (await store?.keys()) ?? [];
    if (saved.length === 0) return;
    if (fresh.models.length === 0) {
      // Nothing is pinned, so nothing would use the runtime either.
      await store?.clear();
      return;
    }
    const keep = new Set([MANIFEST_KEY, ...deps.keep, ...fresh.models.map(storeKey)]);
    await Promise.all(saved.filter((key) => !keep.has(key)).map((key) => store?.delete(key)));
    await store?.put(MANIFEST_KEY, encode(fresh));
  }

  /** The manifest from the network, else the last one fetched while anything was saved on this device. */
  async function manifest(): Promise<ModelManifest> {
    let failure: Error;
    try {
      const response = await deps.fetch(deps.manifestUrl, { credentials: 'same-origin', cache: 'no-store' });
      if (response.ok) {
        const body: unknown = await response.json().catch((e: unknown) => {
          throw e instanceof SyntaxError ? new ManifestError() : e;
        });
        const fresh = parseManifest(body);
        await refresh(fresh);
        return fresh;
      }
      failure = new DownloadError(deps.manifestUrl, response.status);
      // The site says there is no manifest: a saved copy must not override that. A server error is treated like being offline.
      if (response.status < 500) throw failure;
    } catch (e) {
      if (!(e instanceof TypeError)) throw e; // a network failure; a bad manifest or a 404 is not hidden
      failure = new UnavailableError(deps.manifestUrl);
    }
    const saved = await store?.get(MANIFEST_KEY);
    if (!saved) throw failure;
    return parseManifest(JSON.parse(new TextDecoder().decode(saved)));
  }

  async function createSession(ort: OrtModule, bytes: Uint8Array<ArrayBuffer>, backend: Backend) {
    try {
      // Nodes WebGPU has no kernel for, such as NonMaxSuppression, run on WASM.
      const providers: Backend[] = backend === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];
      return { session: await ort.InferenceSession.create(bytes, { executionProviders: providers, logSeverityLevel: ERRORS_ONLY }), backend };
    } catch (e) {
      if (backend === 'wasm') throw e;
      // A model WebGPU cannot take runs on the CPU instead.
      return { session: await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], logSeverityLevel: ERRORS_ONLY }), backend: 'wasm' as const };
    }
  }

  async function handle(request: ModelHostRequest): Promise<ModelHostResponse> {
    const { id } = request;
    try {
      if (request.type === 'list') {
        const { models } = await manifest();
        const saved = new Set((await store?.keys()) ?? []);
        return { id, ok: true, type: 'listed', models: models.map((m) => ({ name: m.name, version: m.version, size: m.size, cached: saved.has(storeKey(m)) })) };
      }

      if (request.type === 'load') {
        const pins = await manifest();
        const pin = pins.models.find((m) => m.name === request.model);
        if (!pin) return { id, ok: false, error: { code: 'unknown-model', message: `No model named ${request.model} is pinned.` } };
        const { bytes, source } = await verifiedBytes(pin, { fetch: deps.fetch, store });
        // Kept for loading offline. Saved only beside a model, so a visit that loads none stores nothing.
        await store?.put(MANIFEST_KEY, encode(pins));
        // Started once per worker. A start that fails is tried again by the next load.
        runtime ??= deps.startRuntime({ fetch: deps.fetch, store }).catch((e: unknown) => {
          runtime = null;
          throw new RuntimeStartError(e);
        });
        const { ort, backend: preferred } = await runtime;
        await sessions.get(pin.name)?.session.release();
        sessions.delete(pin.name);
        const { session, backend } = await createSession(ort, bytes, preferred);
        sessions.set(pin.name, { pin, session });
        const saved = ((await store?.keys()) ?? []).includes(storeKey(pin));
        return {
          id, ok: true, type: 'loaded',
          model: { name: pin.name, version: pin.version, backend, source, saved, inputNames: [...session.inputNames], outputNames: [...session.outputNames] },
        };
      }

      const loaded = sessions.get(request.model);
      if (!loaded || !runtime) return { id, ok: false, error: { code: 'not-loaded', message: `Load ${request.model} before running it.` } };
      const { ort } = await runtime;
      const feeds: Record<string, Ort.Tensor> = {};
      for (const [name, t] of Object.entries(request.feeds)) feeds[name] = new ort.Tensor('float32', t.data, t.dims);
      const results = await loaded.session.run(feeds);
      const outputs: Record<string, Float32Payload> = {};
      for (const [name, t] of Object.entries(results)) {
        // Counts come out as int32. They are small, so float32 holds them exactly.
        if (!(t.data instanceof Float32Array) && !(t.data instanceof Int32Array)) throw new Error(`Output ${name} is ${t.type}, not float32 or int32.`);
        outputs[name] = { dims: [...t.dims], data: Float32Array.from(t.data) };
      }
      return { id, ok: true, type: 'ran', outputs };
    } catch (e) {
      return { id, ok: false, error: toError(e) };
    }
  }

  // One request at a time, so two loads cannot both make a session, and a load cannot save a
  // manifest over one a list has just replaced. handle never rejects, so the queue never breaks.
  let queue: Promise<unknown> = Promise.resolve();
  return (request: ModelHostRequest): Promise<ModelHostResponse> => {
    const answer = queue.then(() => handle(request));
    queue = answer;
    return answer;
  };
}
