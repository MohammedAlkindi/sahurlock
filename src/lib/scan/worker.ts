import { cleanPage, type LineRemoval } from '@/lib/scan/clean';
import { grayFromRGBA, rgbaFromGray } from '@/lib/scan/gray';

// Runs the page cleanup off the main thread. The photo never leaves the device.

export interface ScanRequest {
  file: Blob;
  lines: LineRemoval;
}

export type ScanResponse =
  | { ok: true; png: Blob; width: number; height: number; pageFound: boolean; skewDegrees: number }
  | { ok: false; error: string };

/** Longest side to work at. A4 at this size is close to 200 dpi, plenty for handwriting. */
const MAX_SIDE = 2400;

const reply = (response: ScanResponse) => self.postMessage(response);

self.onmessage = async (event: MessageEvent<ScanRequest>) => {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(event.data.file);
  } catch {
    reply({ ok: false, error: 'That file could not be opened as an image. Try a JPEG or PNG photo.' });
    return;
  }

  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const source = new OffscreenCanvas(width, height).getContext('2d');
    if (!source) throw new Error('No 2D canvas in this worker.');
    source.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const gray = grayFromRGBA(source.getImageData(0, 0, width, height).data, width, height);
    const { image, page, skewDegrees } = cleanPage(gray, { ...event.data.lines, maxSide: MAX_SIDE });

    const canvas = new OffscreenCanvas(image.width, image.height);
    const target = canvas.getContext('2d');
    if (!target) throw new Error('No 2D canvas in this worker.');
    target.putImageData(new ImageData(new Uint8ClampedArray(rgbaFromGray(image)), image.width, image.height), 0, 0);
    const png = await canvas.convertToBlob({ type: 'image/png' });

    reply({ ok: true, png, width: image.width, height: image.height, pageFound: page !== null, skewDegrees });
  } catch {
    reply({ ok: false, error: 'Something went wrong while cleaning this page. Try another photo.' });
  }
};
