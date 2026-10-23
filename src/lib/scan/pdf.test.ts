import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPdf, jpegInfo } from '@/lib/scan/pdf';

const fixture = (name: string) => new Uint8Array(readFileSync(`src/lib/scan/fixtures/${name}`));
const RGB = fixture('rgb-6x4.jpg');
const GRAY = fixture('gray-3x5.jpg');
const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

describe('jpegInfo', () => {
  it('reads size and channels from the frame header', () => {
    expect(jpegInfo(RGB)).toEqual({ width: 6, height: 4, components: 3 });
    expect(jpegInfo(GRAY)).toEqual({ width: 3, height: 5, components: 1 });
  });

  it('refuses something that is not a JPEG', () => {
    expect(() => jpegInfo(new TextEncoder().encode('%PDF-1.4'))).toThrow('Not a JPEG');
  });
});

describe('buildPdf', () => {
  const pdf = buildPdf([RGB, GRAY], 'a4');
  const body = text(pdf);

  it('is a complete PDF file', () => {
    expect(body.startsWith('%PDF-1.4\n')).toBe(true);
    expect(body.endsWith('%%EOF\n')).toBe(true);
    expect(body).toContain('/Type /Pages /Kids [3 0 R 6 0 R] /Count 2');
  });

  it('has a cross-reference table that points at every object', () => {
    const startxref = Number(body.match(/startxref\n(\d+)\n%%EOF/)![1]);
    expect(body.slice(startxref, startxref + 4)).toBe('xref');
    const entries = [...body.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(8);
    entries.forEach((offset, i) => expect(body.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });

  it('embeds each JPEG unchanged with its own size and colour space', () => {
    expect(body).toContain('/Width 6 /Height 4 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode');
    expect(body).toContain('/Width 3 /Height 5 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode');
    expect(body).toContain(text(RGB));
    expect(body).toContain(text(GRAY));
  });

  it('turns wide scans landscape and fits each scan to the paper', () => {
    expect(body).toContain('/MediaBox [0 0 841.89 595.28]');
    expect(body).toContain('/MediaBox [0 0 595.28 841.89]');
    // A 6 × 4 scan on landscape A4 fills the width (841.89 / 6 per pixel) and is centred top to bottom.
    expect(body).toContain('q 841.89 0 0 561.26 0 17.01 cm /Im0 Do Q');
    // A 3 × 5 scan on portrait A4 fills the height and is centred side to side.
    expect(body).toContain('q 505.13 0 0 841.89 45.07 0 cm /Im0 Do Q');
  });

  it('uses Letter paper when asked', () => {
    expect(text(buildPdf([GRAY], 'letter'))).toContain('/MediaBox [0 0 612 792]');
  });

  it('needs at least one page', () => {
    expect(() => buildPdf([])).toThrow();
  });
});
