import { CLEAN_MAX_SIDE } from '@/lib/scan/output';

/** Most pages read from one PDF. Each page is cleaned at full size, so this bounds memory. */
export const MAX_PDF_PAGES = 40;

export const isPdf = (file: File) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

/**
 * Render each page of a PDF (for example a GoodNotes or Notability export, or
 * a scanner's output) to a PNG at most `maxSide` pixels on its long side, so it
 * can go through the same cleanup as a photo. pdf.js is loaded only when a PDF
 * is chosen, and parses in its own worker served from this app.
 */
export async function pdfToImages(file: File, maxSide = CLEAN_MAX_SIDE): Promise<{ images: File[]; skipped: number }> {
  // The legacy build polyfills recent JavaScript (Map.getOrInsertComputed, for
  // one) that the modern build assumes and many students' browsers lack.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const stem = file.name.replace(/\.pdf$/i, '');
  const images: File[] = [];
  try {
    const count = Math.min(doc.numPages, MAX_PDF_PAGES);
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n);
      const unscaled = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: maxSide / Math.max(unscaled.width, unscaled.height) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render a PDF page.'))), 'image/png'));
      images.push(new File([blob], `${stem}-page-${n}.png`, { type: 'image/png' }));
      page.cleanup();
    }
    return { images, skipped: doc.numPages - count };
  } finally {
    await task.destroy();
  }
}
