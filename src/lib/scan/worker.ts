import { cleanPage, type LineRemoval } from '@/lib/scan/clean';
import { grayFromRGBA, rgbaFromGray } from '@/lib/scan/gray';
import { CLEAN_MAX_SIDE, PAGE_JPEG_QUALITY } from '@/lib/scan/output';

// Runs the page cleanup off the main thread. The photo never leaves the device.

export interface ScanRequest {
  /** Echoed back so the page can match answers to requests. */
  id: string;
  file: Blob;
  lines: LineRemoval;
}

export type ScanResponse =
  | { id: string; ok: true; png: Blob; jpeg: Blob; width: number; height: number; pageFound: boolean; skewDegrees: number }
  | { id: string; ok: false; error: string };


const reply = (response: ScanResponse) => self.postMessage(response);

self.onmessage = async (event: MessageEvent<ScanRequest>) => {
  const { id } = event.data;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(event.data.file);
  } catch {
    reply({ id, ok: false, error: 'That file could not be opened as an image. Try a JPEG or PNG photo.' });
    return;
  }

  try {
    const scale = Math.min(1, CLEAN_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const source = new OffscreenCanvas(width, height).getContext('2d');
    if (!source) throw new Error('No 2D canvas in this worker.');
    source.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const gray = grayFromRGBA(source.getImageData(0, 0, width, height).data, width, height);
    const { image, page, skewDegrees } = cleanPage(gray, { ...event.data.lines, maxSide: CLEAN_MAX_SIDE });

    const canvas = new OffscreenCanvas(image.width, image.height);
    const target = canvas.getContext('2d');
    if (!target) throw new Error('No 2D canvas in this worker.');
    target.putImageData(new ImageData(new Uint8ClampedArray(rgbaFromGray(image)), image.width, image.height), 0, 0);
    const png = await canvas.convertToBlob({ type: 'image/png' });
    // For the PDF and the library.
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: PAGE_JPEG_QUALITY });

    reply({ id, ok: true, png, jpeg, width: image.width, height: image.height, pageFound: page !== null, skewDegrees });
  } catch {
    reply({ id, ok: false, error: 'Something went wrong while cleaning this page. Try another photo.' });
  }
};
