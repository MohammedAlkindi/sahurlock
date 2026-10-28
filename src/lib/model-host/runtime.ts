import type * as Ort from 'onnxruntime-web/webgpu';
import pin from './runtime-pin.json';
import type { ByteSources, GpuNavigator, PinnedFile, Runtime } from './types';
import { verifiedBytes } from './verify';

/** Where scripts/copy-onnxruntime.mjs puts the runtime. The version in the path keeps the files matched. */
export const RUNTIME_BASE = `/vendor/onnxruntime-web/${pin.version}/`;

/** The runtime's WebAssembly binary, checked and saved like a model. */
export const RUNTIME_WASM: PinnedFile = { url: RUNTIME_BASE + pin.wasm.file, sha256: pin.wasm.sha256, size: pin.wasm.size };

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & GpuNavigator).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

/**
 * Starts ONNX Runtime from this app's own copy. The .wasm is checked against its pin and saved
 * like a model, then handed over as wasmBinary, so ONNX Runtime does not fetch it. ONNX Runtime
 * still imports its glue script from wasmPaths, through the HTTP cache like the entry script.
 */
export async function startBrowserRuntime(sources: ByteSources): Promise<Runtime> {
  const wasm = await verifiedBytes(RUNTIME_WASM, sources);
  const backend = (await hasWebGpu()) ? 'webgpu' : 'wasm';
  const entry = RUNTIME_BASE + pin.entry.file;
  // Loaded at run time from public/vendor, not bundled. A string variable keeps Turbopack from resolving it.
  const ort = (await import(/* webpackIgnore: true */ entry)) as typeof Ort;
  ort.env.wasm.wasmPaths = RUNTIME_BASE;
  ort.env.wasm.wasmBinary = wasm.bytes;
  // No cross-origin isolation, so one thread. ONNX Runtime picks one here on its own. Pinning it
  // keeps a later COOP or COEP header from moving the worker to threads untested.
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = 'error';
  return { ort, backend };
}
