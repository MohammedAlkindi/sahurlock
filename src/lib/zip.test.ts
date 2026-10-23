import { describe, expect, it } from 'vitest';
import { buildZip, crc32 } from '@/lib/zip';

const text = (s: string) => new TextEncoder().encode(s);

/** Read a stored-only ZIP back through its central directory, the way unzip tools find files. */
function readZip(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const files = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
    // The local header must agree with the central directory.
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    expect(view.getUint32(offset + 14, true)).toBe(crc);
    const localNameLength = view.getUint16(offset + 26, true);
    const start = offset + 30 + localNameLength + view.getUint16(offset + 28, true);
    files.push({ name, flags, method, crc, data: zip.slice(start, start + size) });
    at += 46 + nameLength;
  }
  return files;
}

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(text('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('buildZip', () => {
  it('stores every file so a reader gets the same bytes back', () => {
    const jpeg = new Uint8Array(5000).map((_, i) => (i * 37) & 0xff);
    const zip = buildZip([
      { name: 'manifest.json', data: text('{"version":1}') },
      { name: 'images/week-4-p1.jpg', data: jpeg },
      { name: 'empty.txt', data: new Uint8Array() },
    ]);
    const files = readZip(zip);
    expect(files.map((f) => f.name)).toEqual(['manifest.json', 'images/week-4-p1.jpg', 'empty.txt']);
    expect(files.every((f) => f.method === 0)).toBe(true);
    expect(files[1].data).toEqual(jpeg);
    for (const f of files) expect(f.crc).toBe(crc32(f.data));
  });

  it('marks names as UTF-8 so titles in any script survive', () => {
    const [file] = readZip(buildZip([{ name: 'images/محاضرة-4.jpg', data: text('x') }]));
    expect(file.name).toBe('images/محاضرة-4.jpg');
    expect(file.flags & 0x0800).toBe(0x0800);
  });

  it('writes an empty archive as just the end record', () => {
    const zip = buildZip([]);
    expect(zip.length).toBe(22);
    expect(readZip(zip)).toEqual([]);
  });

  it('refuses paths that could land outside the folder it is unpacked into, and duplicates', () => {
    const data = text('x');
    for (const name of ['', '/etc/passwd', '../up.txt', 'a/../../b.txt']) expect(() => buildZip([{ name, data }])).toThrow(/Bad ZIP path/);
    expect(() => buildZip([{ name: 'a.txt', data }, { name: 'a.txt', data }])).toThrow(/Duplicate/);
  });

  it('records the time it is given in MS-DOS form', () => {
    const zip = buildZip([{ name: 'a.txt', data: text('x') }], new Date(2026, 9, 23, 14, 5, 30));
    const view = new DataView(zip.buffer);
    expect(view.getUint16(10, true)).toBe((14 << 11) | (5 << 5) | 15);
    expect(view.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (10 << 5) | 23);
  });
});
