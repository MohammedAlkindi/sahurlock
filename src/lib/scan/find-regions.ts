import type { ModelHost } from '@/lib/model-host/client';
import type { Result } from '@/lib/model-host/types';
import { DETECT_SIDE, detectorInput, LAYOUT_MODEL } from '@/lib/scan/detect';

export interface FinderAnswer {
  /** Rows of [class, score, x1, y1, x2, y2] in the page's pixels. */
  rows: Float32Array;
  count: number;
  /** The pinned version that answered, for the suggested regions' origin. */
  version: string;
}

/** Runs the region finder on a cleaned page image, on this device. Never throws: a failure is a ModelHostError. */
export async function findRegions(host: ModelHost, page: { url: string; width: number; height: number }): Promise<Result<FinderAnswer>> {
  const loaded = await host.load(LAYOUT_MODEL);
  if (!loaded.ok) return loaded;
  const [rowsName, countName] = loaded.value.outputNames;

  let pixels: Uint8ClampedArray;
  try {
    const image = new Image();
    image.src = page.url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = DETECT_SIDE;
    canvas.height = DETECT_SIDE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2D canvas in this browser.');
    context.drawImage(image, 0, 0, DETECT_SIDE, DETECT_SIDE);
    pixels = context.getImageData(0, 0, DETECT_SIDE, DETECT_SIDE).data;
  } catch (e) {
    return { ok: false, error: { code: 'runtime', message: e instanceof Error ? e.message : 'The page could not be read.' } };
  }

  const ran = await host.run(LAYOUT_MODEL, {
    image: { dims: [1, 3, DETECT_SIDE, DETECT_SIDE], data: detectorInput(pixels) },
    scale_factor: { dims: [1, 2], data: new Float32Array([DETECT_SIDE / page.height, DETECT_SIDE / page.width]) },
  });
  if (!ran.ok) return ran;
  const rows = ran.value[rowsName];
  const count = ran.value[countName];
  if (!rows || !count) return { ok: false, error: { code: 'runtime', message: 'The region finder gave an answer of an unexpected shape.' } };
  return { ok: true, value: { rows: rows.data, count: count.data[0], version: loaded.value.version } };
}
