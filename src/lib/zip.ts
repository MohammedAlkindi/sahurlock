/**
 * A minimal ZIP writer. Entries are stored without compression: the files
 * that go in (JPEG pages, small JSON) are already compressed or tiny, and
 * storing keeps this small and dependency-free. Names are UTF-8, flagged as
 * such. No ZIP64, so the archive and every entry stay under 4 GiB and fewer
 * than 65,535 entries.
 *
 * The archive is a Blob built from parts: only the small headers are held in
 * memory, and each file's own Blob is referenced rather than copied, so a
 * download of many large pages does not need them all in memory at once.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, the only timestamp the basic ZIP headers hold. Local time, to 2 s. */
function dosTime(date: Date): { time: number; day: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Values that would mean ZIP64 in a header, so sizes, offsets and counts must stay below them. */
const MAX_32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;

export interface ZipWriter {
  /** Add a file from bytes in memory. */
  add(name: string, data: Uint8Array): void;
  /** Add a file by reference to a Blob whose CRC-32 is already known. */
  addBlob(name: string, data: Blob, crc: number): void;
  /** The finished archive. */
  finish(): Blob;
}

export function zipWriter(modified = new Date()): ZipWriter {
  const encoder = new TextEncoder();
  const { time, day } = dosTime(modified);
  const seen = new Set<string>();
  const parts: (Uint8Array<ArrayBuffer> | Blob)[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  const entry = (path: string, data: Uint8Array<ArrayBuffer> | Blob, size: number, crc: number) => {
    if (!path || path.startsWith('/') || path.split('/').includes('..')) throw new Error(`Bad ZIP path: ${path}`);
    if (seen.has(path)) throw new Error(`Duplicate ZIP path: ${path}`);
    if (seen.size + 1 >= MAX_ENTRIES) throw new Error('Too many files for one ZIP.');
    const name = encoder.encode(path);
    if (size >= MAX_32 || offset + 30 + name.length + size >= MAX_32) throw new Error('ZIP too large.');
    seen.add(path);

    // Version 2.0, flag bit 11 for UTF-8 names, method 0 (stored).
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, day, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, size, true);
    dir.setUint32(24, size, true);
    dir.setUint16(28, name.length, true);
    // Extra field, comment, disk number, internal and external attributes are all zero.
    dir.setUint32(42, offset, true);

    parts.push(new Uint8Array(local.buffer), name, data);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + size;
  };

  return {
    add: (name, data) => entry(name, new Uint8Array(data), data.length, crc32(data)),
    addBlob: (name, data, crc) => entry(name, data, data.size, crc),
    finish() {
      const dirSize = central.reduce((n, c) => n + c.length, 0);
      if (offset + dirSize >= MAX_32) throw new Error('ZIP too large.');
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true);
      end.setUint16(8, seen.size, true);
      end.setUint16(10, seen.size, true);
      end.setUint32(12, dirSize, true);
      end.setUint32(16, offset, true);
      return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
    },
  };
}
