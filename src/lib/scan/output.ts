/** How cleaned pages are written. The worker uses these, and a labels download records them. */

/** Longest side to work at. A4 at this size is close to 200 dpi, plenty for handwriting. */
export const CLEAN_MAX_SIDE = 2400;

/** JPEG quality for stored and PDF pages. 0.92 keeps pen strokes crisp at a fraction of the PNG's size. */
export const PAGE_JPEG_QUALITY = 0.92;
