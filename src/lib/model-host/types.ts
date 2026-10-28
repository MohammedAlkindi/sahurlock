import type * as Ort from 'onnxruntime-web/webgpu';

/** A file the app serves itself, pinned to its exact bytes. */
export interface PinnedFile {
  /** Same-origin path. Model files carry part of their hash in the name. */
  url: string;
  /** Lowercase hex SHA-256 of the exact bytes. */
  sha256: string;
  /** Exact length in bytes. */
  size: number;
}

/** One entry in public/models/manifest.json. */
export interface ModelPin extends PinnedFile {
  /** The name code asks for, e.g. "layout-detector". */
  name: string;
  /** Release of these weights. */
  version: string;
}

export interface ModelManifest {
  schema: 1;
  models: ModelPin[];
}

/** Where a model can run. WASM is the CPU fallback. */
export type Backend = 'webgpu' | 'wasm';

/** float32 in. Out, float32 and int32, the second as float32. */
export interface Float32Payload {
  dims: number[];
  data: Float32Array<ArrayBuffer>;
}

export type ModelHostRequest =
  | { id: string; type: 'list' }
  | { id: string; type: 'load'; model: string }
  | { id: string; type: 'run'; model: string; feeds: Record<string, Float32Payload> };

export type ModelHostErrorCode =
  | 'unknown-model'
  | 'not-loaded'
  | 'bad-manifest'
  /** Offline, and not saved on this device. */
  | 'unavailable'
  /** The site answered with an error status. */
  | 'download'
  | 'size'
  | 'sha256'
  | 'runtime';

export interface ModelHostError {
  code: ModelHostErrorCode;
  message: string;
}

export interface ModelSummary {
  name: string;
  version: string;
  size: number;
  cached: boolean;
}

export interface LoadedModel {
  name: string;
  version: string;
  backend: Backend;
  source: 'network' | 'cache';
  /** Whether a checked copy is now kept on this device. False when the device would not save it. */
  saved: boolean;
  inputNames: string[];
  outputNames: string[];
}

export type ModelHostResponse =
  | { id: string; ok: true; type: 'listed'; models: ModelSummary[] }
  | { id: string; ok: true; type: 'loaded'; model: LoadedModel }
  | { id: string; ok: true; type: 'ran'; outputs: Record<string, Float32Payload> }
  | { id: string; ok: false; error: ModelHostError };

/** A ModelHost call's outcome. The host never throws. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: ModelHostError };

/** Bytes kept on the device, by key. Cache Storage in the browser, a Map in tests. */
export interface ByteStore {
  get(key: string): Promise<Uint8Array<ArrayBuffer> | null>;
  put(key: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  /** Deletes everything, leaving nothing behind. */
  clear(): Promise<void>;
}

/** WebGPU is not in TypeScript's DOM library. Only this much of it is used. */
export interface GpuNavigator {
  gpu?: { requestAdapter(): Promise<object | null> };
}

/** Where pinned files come from: the network, and the copies kept on this device. */
export interface ByteSources {
  fetch: typeof fetch;
  store: ByteStore | null;
}

/** The part of ONNX Runtime the host uses. The browser build and the Node build both have it. */
export type OrtModule = Pick<typeof Ort, 'InferenceSession' | 'Tensor'>;

export interface Runtime {
  ort: OrtModule;
  backend: Backend;
}

export interface HostDeps extends ByteSources {
  manifestUrl: string;
  /** Saved keys to keep when the manifest changes, besides its models': the runtime's own file. */
  keep: string[];
  /** Starts ONNX Runtime from the same sources. Called only after a model's bytes have passed their check. */
  startRuntime: (sources: ByteSources) => Promise<Runtime>;
}
