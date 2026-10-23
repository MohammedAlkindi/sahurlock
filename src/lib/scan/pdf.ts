/**
 * A minimal PDF writer for scanned pages: one JPEG per page, scaled to fit the
 * paper and centred, turned landscape when the scan is wider than tall. JPEG
 * data goes in unchanged (PDF's DCTDecode), so nothing is re-encoded.
 */

export type Paper = 'a4' | 'letter';

/** Paper sizes in PDF points (1/72 inch), portrait. */
export const PAPER_SIZES: Record<Paper, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

export interface JpegInfo {
  width: number;
  height: number;
  components: 1 | 3 | 4;
}

/** Read a JPEG's size and channel count from its start-of-frame marker. */
export function jpegInfo(bytes: Uint8Array): JpegInfo {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Not a JPEG.');
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    // Start-of-frame markers, excluding DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      const components = bytes[i + 9];
      if (components !== 1 && components !== 3 && components !== 4) throw new Error('Unsupported JPEG colour layout.');
      return { width, height, components };
    }
    i += 2 + length;
  }
  throw new Error('JPEG has no frame header.');
}

const COLOUR_SPACE = { 1: '/DeviceGray', 3: '/DeviceRGB', 4: '/DeviceCMYK' } as const;
const num = (n: number) => (Math.round(n * 100) / 100).toString();

export function buildPdf(jpegs: Uint8Array[], paper: Paper = 'a4'): Uint8Array {
  if (jpegs.length === 0) throw new Error('A PDF needs at least one page.');
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const write = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length;
    write(`${id} 0 obj\n${body}\n`);
    if (stream) { write('stream\n'); write(stream); write('\nendstream\n'); }
    write('endobj\n');
  };

  // Objects: 1 catalog, 2 page tree, then three per page (page, image, contents).
  const pageId = (i: number) => 3 + i * 3;
  write('%PDF-1.4\n');
  write(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // marks the file as binary
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${jpegs.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${jpegs.length} >>`);

  jpegs.forEach((jpeg, i) => {
    const { width, height, components } = jpegInfo(jpeg);
    const [short, long] = PAPER_SIZES[paper];
    const [pw, ph] = width > height ? [long, short] : [short, long];
    const scale = Math.min(pw / width, ph / height);
    const dw = width * scale, dh = height * scale;
    const content = encoder.encode(`q ${num(dw)} 0 0 ${num(dh)} ${num((pw - dw) / 2)} ${num((ph - dh) / 2)} cm /Im0 Do Q`);
    const id = pageId(i);
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pw)} ${num(ph)}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    object(id + 1, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${COLOUR_SPACE[components]} /BitsPerComponent 8 /Filter /DCTDecode${components === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : ''} /Length ${jpeg.length} >>`, jpeg);
    object(id + 2, `<< /Length ${content.length} >>`, content);
  });

  const count = 3 + jpegs.length * 3;
  const xref = length;
  write(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) write(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  write(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}
