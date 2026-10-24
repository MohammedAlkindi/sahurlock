/**
 * Read a stored-only ZIP back through its central directory, the way unzip
 * tools find files, checking each local header against it. For tests of the
 * archives the app writes: the app itself never imports this.
 */

export interface ZipFile {
  name: string;
  flags: number;
  method: number;
  crc: number;
  data: Uint8Array;
}

export function readZip(zip: Uint8Array): ZipFile[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const fail = (why: string) => { throw new Error(`Not a valid ZIP: ${why}`); };
  const end = zip.length - 22;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) fail('no end record');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const files: ZipFile[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) fail(`entry ${i} has no central header`);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
    if (view.getUint32(offset, true) !== 0x04034b50) fail(`${name} has no local header`);
    if (view.getUint32(offset + 14, true) !== crc) fail(`${name}'s local CRC differs`);
    const localNameLength = view.getUint16(offset + 26, true);
    if (decoder.decode(zip.subarray(offset + 30, offset + 30 + localNameLength)) !== name) fail(`${name}'s local name differs`);
    const start = offset + 30 + localNameLength + view.getUint16(offset + 28, true);
    files.push({ name, flags, method, crc, data: zip.slice(start, start + size) });
    at += 46 + nameLength;
  }
  return files;
}
