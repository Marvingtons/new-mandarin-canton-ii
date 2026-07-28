import "server-only";

/**
 * RGBA raster -> ESC/POS bitmap commands.
 *
 * PrintNode accepts `raw_base64` (printer command bytes) or `pdf_base64`. It
 * has no PNG content type, so "send the image" means "send the image as the
 * printer's own raster command". That is the right target anyway: GS v 0 is
 * a pure bitmap blit, which is exactly why this path sidesteps the CJK
 * code-page lottery that ruled out sending text.
 *
 * Reference: ESC/POS `GS v 0` — print raster bit image.
 *   1D 76 30 m xL xH yL yH  d1...dk
 *   m  = 0 (normal density)
 *   x  = bytes per row  (width / 8)
 *   y  = number of rows in this band
 *   d  = 1 bit per pixel, MSB leftmost, 1 = BLACK (ink)
 */

/** Below this luminance a pixel is ink. Ticket art is pure black/white. */
const BLACK_THRESHOLD = 128;

/**
 * Rows per GS v 0 command. Many printers have a modest input buffer and choke
 * on a single multi-thousand-row raster, so the image goes out in bands.
 */
const BAND_ROWS = 128;

const ESC = 0x1b;
const GS = 0x1d;

export interface RasterOptions {
  /** Blank lines fed after the ticket, so the cut lands clear of the text. */
  feedLines?: number;
  /** Emit a partial cut at the end. */
  cut?: boolean;
}

/**
 * Pack one row of RGBA pixels into MSB-first mono bits.
 * Alpha is composited over white: satori/resvg give us an opaque canvas, but a
 * transparent pixel must read as paper, not as ink.
 */
function packRow(
  pixels: Buffer,
  rowStart: number,
  width: number,
  out: Buffer,
  outStart: number,
): void {
  for (let x = 0; x < width; x++) {
    const p = rowStart + x * 4;
    const alpha = pixels[p + 3] / 255;
    // Perceptual luminance, then composite over white paper.
    const lum =
      0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
    const onPaper = lum * alpha + 255 * (1 - alpha);
    if (onPaper < BLACK_THRESHOLD) {
      out[outStart + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
}

/**
 * Encode an RGBA buffer as ESC/POS raster commands ready for `raw_base64`.
 *
 * `width` must be a multiple of 8 for a clean pack; 576 (80mm at 203dpi) is,
 * and anything else is padded with paper-white on the right.
 */
export function rasterToEscPos(
  pixels: Buffer,
  width: number,
  height: number,
  options: RasterOptions = {},
): Buffer {
  const { feedLines = 4, cut = true } = options;
  const bytesPerRow = Math.ceil(width / 8);
  const chunks: Buffer[] = [];

  // ESC @ — reset the printer to a known state. Without this, a previous job's
  // leftover mode (inverted, rotated, double-width) corrupts this ticket.
  chunks.push(Buffer.from([ESC, 0x40]));

  for (let bandStart = 0; bandStart < height; bandStart += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, height - bandStart);
    const data = Buffer.alloc(bytesPerRow * rows); // zero = white

    for (let y = 0; y < rows; y++) {
      packRow(
        pixels,
        (bandStart + y) * width * 4,
        width,
        data,
        y * bytesPerRow,
      );
    }

    const header = Buffer.from([
      GS,
      0x76,
      0x30,
      0x00, // m = normal density
      bytesPerRow & 0xff,
      (bytesPerRow >> 8) & 0xff,
      rows & 0xff,
      (rows >> 8) & 0xff,
    ]);
    chunks.push(header, data);
  }

  if (feedLines > 0) {
    // ESC d n — feed n lines.
    chunks.push(Buffer.from([ESC, 0x64, Math.min(255, feedLines)]));
  }
  if (cut) {
    // GS V 66 0 — partial cut, feeding first. The widely supported variant.
    chunks.push(Buffer.from([GS, 0x56, 66, 0x00]));
  }

  return Buffer.concat(chunks);
}
