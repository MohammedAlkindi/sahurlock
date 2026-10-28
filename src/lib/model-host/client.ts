import type { Float32Payload, LoadedModel, ModelHostError, ModelHostRequest, ModelHostResponse, ModelSummary, Result } from './types';

// Distributes Omit over the request union, so each variant keeps its own fields.
type Body<R> = R extends ModelHostRequest ? Omit<R, 'id'> : never;

let next = 0;

/** The page's side of the model worker. Methods never throw: a failure is a ModelHostError. */
export class ModelHost {
  private worker: Worker | null = null;
  private pending = new Map<string, (response: ModelHostResponse) => void>();

  private start(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./worker.ts', import.meta.url));
    worker.onmessage = (event: MessageEvent<ModelHostResponse>) => {
      this.pending.get(event.data.id)?.(event.data);
      this.pending.delete(event.data.id);
    };
    worker.onerror = (event) => this.failAll(event.message || 'The model worker stopped.');
    worker.onmessageerror = () => this.failAll('The model worker sent an answer that could not be read.');
    this.worker = worker;
    return worker;
  }

  private failAll(message: string) {
    for (const [id, done] of this.pending) done({ id, ok: false, error: { code: 'runtime', message } });
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }

  private send(body: Body<ModelHostRequest>): Promise<ModelHostResponse> {
    const id = `m${++next}`;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      try {
        this.start().postMessage({ ...body, id });
      } catch (e) {
        this.failAll(e instanceof Error ? e.message : 'The model worker could not start.');
      }
    });
  }

  async list(): Promise<Result<ModelSummary[]>> {
    const r = await this.send({ type: 'list' });
    return r.ok ? (r.type === 'listed' ? { ok: true, value: r.models } : unexpected()) : { ok: false, error: r.error };
  }

  async load(model: string): Promise<Result<LoadedModel>> {
    const r = await this.send({ type: 'load', model });
    // A failed start can leave ONNX Runtime unusable in that worker, so the next call gets a new one.
    if (!r.ok && r.error.code === 'runtime') this.failAll(r.error.message);
    return r.ok ? (r.type === 'loaded' ? { ok: true, value: r.model } : unexpected()) : { ok: false, error: r.error };
  }

  async run(model: string, feeds: Record<string, Float32Payload>): Promise<Result<Record<string, Float32Payload>>> {
    const r = await this.send({ type: 'run', model, feeds });
    return r.ok ? (r.type === 'ran' ? { ok: true, value: r.outputs } : unexpected()) : { ok: false, error: r.error };
  }

  dispose() {
    this.failAll('The model host was closed.');
  }
}

function unexpected(): { ok: false; error: ModelHostError } {
  return { ok: false, error: { code: 'runtime', message: 'The model worker gave an unexpected answer.' } };
}
