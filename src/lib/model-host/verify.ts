import type { ByteSources, ModelManifest, ModelPin, PinnedFile } from './types';

/** Bytes that do not match their pin. Nothing that throws this reaches ONNX Runtime. */
export class IntegrityError extends Error {
  readonly code: 'size' | 'sha256';
  constructor(code: 'size' | 'sha256', url: string) {
    super(`${url} does not match its pinned ${code === 'size' ? 'size' : 'SHA-256'}.`);
    this.name = 'IntegrityError';
    this.code = code;
  }
}

/** The model manifest is not valid JSON, or not in the form parseManifest accepts. */
export class ManifestError extends Error {
  constructor() {
    super('The model manifest is not in the expected form.');
    this.name = 'ManifestError';
  }
}

/** The site answered with an error status. */
export class DownloadError extends Error {
  constructor(url: string, status: number) {
    super(`${url} could not be downloaded: the site answered ${status}.`);
    this.name = 'DownloadError';
  }
}

/** Neither the network nor this device has the file. */
export class UnavailableError extends Error {
  constructor(url: string) {
    super(`${url} could not be fetched and is not saved on this device.`);
    this.name = 'UnavailableError';
  }
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Throws IntegrityError unless the bytes are exactly the pinned file. Size first, as it is free. */
export async function checkBytes(pin: PinnedFile, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  if (bytes.byteLength !== pin.size) throw new IntegrityError('size', pin.url);
  if ((await sha256Hex(bytes)) !== pin.sha256) throw new IntegrityError('sha256', pin.url);
}

/** The key a pinned file is saved under. A new hash is a new key, so an old copy is never reused. */
export const storeKey = (pin: PinnedFile) => `${pin.url}?sha256=${pin.sha256}`;

/** The body of a response for a pinned file, refused as soon as it runs longer than the pin, so a wrong file is not downloaded in full. */
async function readPinned(pin: PinnedFile, response: Response): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = new Uint8Array(pin.size);
  let length = 0;
  const reader = response.body?.getReader();
  if (reader) {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      if (length + chunk.value.byteLength > pin.size) {
        await reader.cancel();
        throw new IntegrityError('size', pin.url);
      }
      bytes.set(chunk.value, length);
      length += chunk.value.byteLength;
    }
  }
  if (length !== pin.size) throw new IntegrityError('size', pin.url);
  return bytes;
}

/**
 * The pinned file's bytes, checked: a saved copy that still matches, else the network.
 * Only bytes that passed are saved. A saved copy that fails is deleted.
 */
export async function verifiedBytes(pin: PinnedFile, { fetch, store }: ByteSources): Promise<{ bytes: Uint8Array<ArrayBuffer>; source: 'cache' | 'network' }> {
  const key = storeKey(pin);
  const saved = await store?.get(key);
  if (saved) {
    try {
      await checkBytes(pin, saved);
      return { bytes: saved, source: 'cache' };
    } catch {
      await store?.delete(key);
    }
  }
  let response: Response;
  try {
    response = await fetch(pin.url, { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new UnavailableError(pin.url);
  }
  if (!response.ok) throw new DownloadError(pin.url, response.status);
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await readPinned(pin, response);
  } catch (e) {
    // The connection dropped part way.
    throw e instanceof TypeError ? new UnavailableError(pin.url) : e;
  }
  await checkBytes(pin, bytes);
  await store?.put(key, bytes);
  return { bytes, source: 'network' };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const SHA256 = /^[0-9a-f]{64}$/;
/** A file directly under /models/, named so its address needs no encoding and so matches the key Cache Storage gives back. */
const MODEL_URL = /^\/models\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isPin(v: unknown): v is ModelPin {
  return isRecord(v)
    && typeof v.name === 'string' && typeof v.version === 'string'
    && typeof v.url === 'string' && MODEL_URL.test(v.url)
    && typeof v.sha256 === 'string' && SHA256.test(v.sha256)
    && typeof v.size === 'number' && Number.isSafeInteger(v.size) && v.size > 0;
}

/** Throws ManifestError unless the value is a schema 1 manifest whose entries are same-origin and well formed. */
export function parseManifest(value: unknown): ModelManifest {
  if (!isRecord(value) || value.schema !== 1 || !Array.isArray(value.models) || !value.models.every(isPin)) {
    throw new ManifestError();
  }
  return { schema: 1, models: value.models };
}
