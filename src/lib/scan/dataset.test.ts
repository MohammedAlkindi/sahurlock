import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildLabelsZip, labeledPages, labelsFileName, LabelsTooLargeError } from '@/lib/scan/dataset';
import { type Block, BLOCK_KINDS, DOCUMENT_VERSION, userBlock } from '@/lib/scan/document';
import type { SavedScan } from '@/lib/scan/library';
import { readZip } from '@/lib/zip-read';

const fixture = (name: string) => new Uint8Array(readFileSync(`src/lib/scan/fixtures/${name}`));
const RGB = fixture('rgb-6x4.jpg');
const GRAY = fixture('gray-3x5.jpg');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

interface PageSpec { jpeg?: Uint8Array | Blob; width?: number; height?: number; complete?: boolean; blocks?: Block[] }

function scan(id: string, specs: PageSpec[], extra: Partial<SavedScan> = {}): SavedScan {
  const pages = specs.map((p) => {
    const jpeg = p.jpeg ?? RGB;
    return { jpeg: jpeg instanceof Blob ? jpeg : new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), width: p.width ?? 6, height: p.height ?? 4 };
  });
  return {
    id, title: `Scan ${id}`, course: 'PHYS 2A', createdAt: '2026-10-23T19:12:00.000Z', pages,
    document: {
      version: DOCUMENT_VERSION,
      pages: specs.map((p, i) => ({ width: pages[i].width, height: pages[i].height, regionsComplete: p.complete ?? false, blocks: p.blocks ?? [] })),
    },
    ...extra,
  };
}

const box = { x: 1, y: 1, width: 2, height: 2 };
const math = () => ({ ...userBlock('m1', 'math', box), content: 'F = ma' });
const guess = (reviewed: boolean): Block => ({ ...userBlock('g1', 'text', box), origin: { by: 'model', model: 'detector', version: '0.1.0' }, reviewed });
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

describe('labeledPages', () => {
  it('takes pages marked complete or with a label, and nothing else', () => {
    const s = scan('a', [{ complete: true }, { blocks: [math()] }, {}]);
    expect(labeledPages([s]).map((p) => p.position)).toEqual([0, 1]);
  });

  it('counts a model’s guess only once the user has checked it', () => {
    expect(labeledPages([scan('a', [{ blocks: [guess(false)] }])])).toEqual([]);
    expect(labeledPages([scan('a', [{ blocks: [guess(true), guess(false)] }])])[0].blocks).toHaveLength(1);
  });

  it('leaves out scans whose labels could not be read', () => {
    expect(labeledPages([scan('a', [{ complete: true }], { labelsUnreadable: true })])).toEqual([]);
  });
});

describe('buildLabelsZip', () => {
  const now = new Date(2026, 9, 23, 20, 30);

  it('writes the manifest, one line per page and each image named by its hash', async () => {
    const scans = [scan('newer', [{ blocks: [math()], complete: true }, { jpeg: GRAY, width: 3, height: 5, blocks: [userBlock('t1', 'text', box)] }])];
    const result = await buildLabelsZip(scans, now);
    const files = readZip(await bytesOf(result.zip));
    const names = files.map((f) => f.name);
    const hashes = [sha(RGB), sha(GRAY)].sort();
    expect(names).toEqual(['manifest.json', 'pages.jsonl', ...hashes.map((h) => `images/${h}.jpg`)]);
    for (const h of hashes) expect(files.find((f) => f.name === `images/${h}.jpg`)!.data).toEqual(h === sha(RGB) ? RGB : GRAY);

    const lines = new TextDecoder().decode(files[1].data);
    expect(lines.endsWith('\n')).toBe(true);
    const parsed = lines.trimEnd().split('\n').map((l) => JSON.parse(l));
    expect(parsed.map((p) => p.sha256)).toEqual(hashes);
    const rgbLine = parsed.find((p) => p.sha256 === sha(RGB));
    expect(Object.keys(rgbLine)).toEqual(['image', 'sha256', 'width', 'height', 'scan', 'position', 'course', 'savedAt', 'regionsComplete', 'blocks']);
    expect(rgbLine).toMatchObject({ image: `images/${sha(RGB)}.jpg`, width: 6, height: 4, scan: 'newer', position: 0, course: 'PHYS 2A', regionsComplete: true });
    expect(rgbLine.blocks).toEqual([{ id: 'm1', kind: 'math', box, content: 'F = ma', tokens: [], origin: { by: 'user' }, reviewed: true }]);
    expect(Object.keys(rgbLine.blocks[0])).toEqual(['id', 'kind', 'box', 'content', 'tokens', 'origin', 'reviewed']);

    const manifest = JSON.parse(new TextDecoder().decode(files[0].data));
    expect(manifest).toMatchObject({ format: 'sahurlock-labels', formatVersion: 1, documentVersion: 1, exportedAt: now.toISOString(), kinds: BLOCK_KINDS });
    expect(manifest.counts).toEqual({
      scans: 1, pages: 2, regionsCompletePages: 1,
      blocks: { text: 1, heading: 0, math: 1, table: 0, graph: 0, diagram: 0 },
      blocksWithContent: 1,
      skipped: { duplicateImage: 0, sizeMismatch: 0, unreadableLabels: 0 },
    });
    expect(result).toMatchObject({ pages: 2, scans: 1, completePages: 1 });
  });

  it('gives the same pages.jsonl for the same labels', async () => {
    const make = () => [scan('a', [{ blocks: [math()] }, { jpeg: GRAY, width: 3, height: 5, complete: true }])];
    const lines = async () => readZip(await bytesOf((await buildLabelsZip(make(), now)).zip))[1].data;
    expect(await lines()).toEqual(await lines());
  });

  it('writes a page image used twice once, from the newest scan, and skips images of the wrong size', async () => {
    const scans = [
      scan('newer', [{ blocks: [math()] }]),
      scan('older', [{ blocks: [userBlock('x', 'text', box)] }]),
      scan('odd', [{ jpeg: GRAY, width: 30, height: 50, complete: true }]),
      scan('lost', [{ complete: true }], { labelsUnreadable: true }),
    ];
    const result = await buildLabelsZip(scans, now);
    expect(result.skipped).toEqual({ duplicateImage: 1, sizeMismatch: 1, unreadableLabels: 1 });
    const files = readZip(await bytesOf(result.zip));
    const [line] = new TextDecoder().decode(files[1].data).trimEnd().split('\n').map((l) => JSON.parse(l));
    expect(line.scan).toBe('newer');
    expect(files).toHaveLength(3);
  });

  it('reads the pages one at a time', async () => {
    let reading = 0, most = 0;
    class Counted extends Blob {
      async arrayBuffer() {
        most = Math.max(most, ++reading);
        const buffer = await super.arrayBuffer();
        await new Promise((r) => setTimeout(r, 5));
        reading--;
        return buffer;
      }
    }
    const pages = Array.from({ length: 4 }, (_, i) => ({ jpeg: new Counted([i % 2 ? GRAY : RGB]), width: i % 2 ? 3 : 6, height: i % 2 ? 5 : 4, complete: true }));
    await buildLabelsZip([scan('a', pages)], now);
    expect(most).toBe(1);
  });

  it('refuses a download too large for a ZIP before reading any page', async () => {
    let read = false;
    class Huge extends Blob {
      get size() { return 0xf0000000; }
      async arrayBuffer() { read = true; return super.arrayBuffer(); }
    }
    await expect(buildLabelsZip([scan('a', [{ jpeg: new Huge([RGB]), complete: true }])], now)).rejects.toBeInstanceOf(LabelsTooLargeError);
    expect(read).toBe(false);
  });

  it('names the file with the local date', () => {
    expect(labelsFileName(new Date(2026, 9, 23, 23, 50))).toBe('sahurlock-labels-2026-10-23.zip');
  });
});
