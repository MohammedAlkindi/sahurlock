/**
 * A minimal ZIP writer. Entries are stored without compression: the files
 * that go in (JPEG pages, small JSON) are already compressed or tiny, and
 * storing keeps this small and dependency-free. Names are UTF-8, flagged as
 * such, so Arabic or accented titles survive. No ZIP64, so the archive and
 * every entry stay under 4 GiB and 65,535 entries.
 */

export interface ZipEntry {
  /** Path inside the archive, with forward slashes. */
  name: string;
  data: Uint8Array;
}

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

const LIMIT = 0xffffffff;

export function buildZip(entries: ZipEntry[], modified = new Date()): Uint8Array {
  if (entries.length > 0xffff) throw new Error('Too many files for one ZIP.');
  const encoder = new TextEncoder();
  const { time, day } = dosTime(modified);
  const seen = new Set<string>();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith('/') || entry.name.split('/').includes('..')) throw new Error(`Bad ZIP path: ${entry.name}`);
    if (seen.has(entry.name)) throw new Error(`Duplicate ZIP path: ${entry.name}`);
    seen.add(entry.name);
    const name = encoder.encode(entry.name);
    const size = entry.data.length;
    if (size > LIMIT || offset > LIMIT) throw new Error('ZIP too large.');
    const crc = crc32(entry.data);

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

    chunks.push(new Uint8Array(local.buffer), name, entry.data);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + size;
  }

  const dirSize = central.reduce((n, c) => n + c.length, 0);
  if (offset + dirSize > LIMIT) throw new Error('ZIP too large.');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);

  const out = new Uint8Array(offset + dirSize + 22);
  let at = 0;
  for (const chunk of [...chunks, ...central, new Uint8Array(end.buffer)]) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
