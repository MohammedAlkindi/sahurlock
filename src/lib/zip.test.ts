import { describe, expect, it } from 'vitest';
import { crc32, zipWriter } from '@/lib/zip';
import { readZip } from '@/lib/zip-read';

const text = (s: string) => new TextEncoder().encode(s);
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(text('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('zipWriter', () => {
  it('stores every file so a reader gets the same bytes back', async () => {
    const jpeg = new Uint8Array(5000).map((_, i) => (i * 37) & 0xff);
    const zip = zipWriter();
    zip.add('manifest.json', text('{"version":1}'));
    zip.addBlob('images/week-4-p1.jpg', new Blob([jpeg], { type: 'image/jpeg' }), crc32(jpeg));
    zip.add('empty.txt', new Uint8Array());
    const archive = zip.finish();
    expect(archive.type).toBe('application/zip');
    const files = readZip(await bytesOf(archive));
    expect(files.map((f) => f.name)).toEqual(['manifest.json', 'images/week-4-p1.jpg', 'empty.txt']);
    expect(files.every((f) => f.method === 0)).toBe(true);
    expect(files[1].data).toEqual(jpeg);
    for (const f of files) expect(f.crc).toBe(crc32(f.data));
  });

  it('writes the same bytes whether a file comes as bytes or as a Blob', async () => {
    const data = text('F = ma');
    const when = new Date(2026, 9, 23, 14, 5, 30);
    const a = zipWriter(when);
    a.add('a.txt', data);
    const b = zipWriter(when);
    b.addBlob('a.txt', new Blob([data]), crc32(data));
    expect(await bytesOf(a.finish())).toEqual(await bytesOf(b.finish()));
  });

  it('keeps an added file as it was, even if the caller changes its array later', async () => {
    const data = text('first');
    const zip = zipWriter();
    zip.add('a.txt', data);
    data.set(text('xxxxx'));
    expect(new TextDecoder().decode(readZip(await bytesOf(zip.finish()))[0].data)).toBe('first');
  });

  it('marks names as UTF-8 so titles in any script survive', async () => {
    const zip = zipWriter();
    zip.add('images/محاضرة-4.jpg', text('x'));
    const [file] = readZip(await bytesOf(zip.finish()));
    expect(file.name).toBe('images/محاضرة-4.jpg');
    expect(file.flags & 0x0800).toBe(0x0800);
  });

  it('writes an empty archive as just the end record', async () => {
    const zip = await bytesOf(zipWriter().finish());
    expect(zip.length).toBe(22);
    expect(readZip(zip)).toEqual([]);
  });

  it('refuses paths that could land outside the folder it is unpacked into, and duplicates', () => {
    const data = text('x');
    for (const name of ['', '/etc/passwd', '../up.txt', 'a/../../b.txt']) expect(() => zipWriter().add(name, data)).toThrow(/Bad ZIP path/);
    const zip = zipWriter();
    zip.add('a.txt', data);
    expect(() => zip.add('a.txt', data)).toThrow(/Duplicate/);
  });

  it('refuses more files than a ZIP without ZIP64 can count', () => {
    const zip = zipWriter();
    const empty = new Uint8Array();
    for (let i = 0; i < 0xfffe; i++) zip.add(`${i}`, empty);
    expect(() => zip.add('one-too-many', empty)).toThrow(/Too many files/);
  });

  it('records the time it is given in MS-DOS form', async () => {
    const zip = zipWriter(new Date(2026, 9, 23, 14, 5, 30));
    zip.add('a.txt', text('x'));
    const view = new DataView((await bytesOf(zip.finish())).buffer);
    expect(view.getUint16(10, true)).toBe((14 << 11) | (5 << 5) | 15);
    expect(view.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (10 << 5) | 23);
  });
});
