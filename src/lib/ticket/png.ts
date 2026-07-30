/**
 * A minimal PNG encoder for thermal print jobs.
 *
 * WHAT THIS EMITS: 1 bit per pixel, colour type 0 (greyscale), one sample per
 * pixel where 0 is black and 1 is white. Star's format notes name "1 bit per
 * pixel" FIRST among the image formats a CloudPRNT printer decodes, and it is
 * the honest description of this artifact — the ticket is pure black on white
 * by design, because a thermal head has no midtones to print. Anything wider
 * was carrying 23 bits per pixel that the printer would have thresholded away
 * itself.
 *
 * HOW WE GOT HERE. resvg's own asPng() emits colour type 6 (8-bit truecolour
 * WITH alpha); the TSP143IV answered that with `code=511 Media Decoding
 * Error`. Re-encoding as colour type 2 (24-bit, no alpha) produced a file that
 * is valid by every decoder we could point at it — and the printer still
 * answered 511. Alpha was not the problem, or not the only one. Bit depth is
 * the remaining candidate Star actually names, and it is also the one that
 * makes the file an order of magnitude smaller, which matters against a
 * printer-declared height ceiling.
 *
 * CONSTRAINTS THIS FILE HONOURS, all of them things the printer cares about:
 *   - Bit depth 1, colour type 0. No alpha, no palette, no colour.
 *   - Non-interlaced. Adam7 would make the firmware buffer the whole image.
 *   - Exactly three chunks: IHDR, IDAT, IEND. No text, no gAMA, no pHYs —
 *     an embedded decoder has fewer places to disagree with us.
 *
 * RUNS ON WORKERD: no native modules, no wasm, no zlib binding. Deflate comes
 * from CompressionStream, which is a platform API on both workerd and Node.
 */

/** Table-driven CRC-32, as the PNG spec defines it. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, data, CRC over type+data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** zlib-wrapped deflate — exactly what an IDAT payload is. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(
    new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate")),
  );
  return new Uint8Array(await stream.arrayBuffer());
}

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Bytes per scanline at 1 bit per pixel — 8 pixels to the byte. */
export function monoStride(width: number): number {
  return (width + 7) >> 3;
}

/**
 * Threshold a pixel to ink or paper.
 *
 * Rec. 601 luma, composited over white first so a partially transparent pixel
 * is judged on the colour it will actually print as rather than its own. The
 * cut is at 50%: the ticket is drawn in pure black on pure white, so the only
 * pixels anywhere near the boundary are antialiasing on glyph edges, and those
 * genuinely are a coin toss that the printer would otherwise make itself.
 */
function isInk(r: number, g: number, b: number, a: number): boolean {
  if (a !== 255) {
    const alpha = a / 255;
    r = r * alpha + 255 * (1 - alpha);
    g = g * alpha + 255 * (1 - alpha);
    b = b * alpha + 255 * (1 - alpha);
  }
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

/**
 * Where a too-tall ticket may be cut, and where it may not.
 *
 * A printer that declares a maximum decodable height leaves two options for a
 * ticket taller than it: send nothing, or send it in pieces. Pieces are only
 * acceptable if no piece ends in the middle of a line of type — half a dish
 * name across a tear is worse than a ticket that never printed, because it
 * looks like it worked.
 *
 * So the cut points are read off the raster itself rather than guessed from
 * layout metrics: a row may be cut on only if every pixel in it is paper, by
 * the SAME threshold the encoder uses, which is why this lives beside it. The
 * search walks BACK from the ceiling, so each piece is as tall as it can be
 * while still ending in whitespace — in practice the gap between two lines,
 * and on a multi-copy job the tear line's own generous margin.
 *
 * Returns the row indices to cut at. Empty means it already fits.
 *
 * Throws rather than cutting blind when a stretch taller than the ceiling has
 * no blank row in it at all. The caller must treat that as a render failure:
 * the order stays visible to the board and to the unprinted-order alert, which
 * is the correct outcome for a ticket this printer cannot be sent.
 */
export function findSegmentCuts(
  rgba: Uint8Array,
  width: number,
  height: number,
  maxHeight: number,
): number[] {
  if (maxHeight <= 0 || height <= maxHeight) return [];

  // One pass for the whole image; the per-segment search then only reads flags.
  const blank = new Uint8Array(height);
  for (let y = 0; y < height; y++) {
    let src = y * width * 4;
    let clean = 1;
    for (let x = 0; x < width; x++) {
      if (isInk(rgba[src], rgba[src + 1], rgba[src + 2], rgba[src + 3])) {
        clean = 0;
        break;
      }
      src += 4;
    }
    blank[y] = clean;
  }

  const cuts: number[] = [];
  let start = 0;
  while (height - start > maxHeight) {
    const ceiling = start + maxHeight;
    let cut = -1;
    for (let y = ceiling; y > start; y--) {
      if (blank[y]) {
        cut = y;
        break;
      }
    }
    if (cut < 0) {
      throw new Error(
        `rows ${start}-${ceiling} carry no blank row, so a ${maxHeight}px ceiling ` +
          "cannot be met without cutting through a line of the ticket",
      );
    }
    cuts.push(cut);
    start = cut;
    // Each pass strictly advances, so this cannot spin — but a ticket that
    // needs this many pieces is a bug upstream, not a job worth sending.
    if (cuts.length > 64) {
      throw new Error(`a ${maxHeight}px ceiling splits this ticket into over 64 jobs`);
    }
  }
  return cuts;
}

/**
 * Composite RGBA over opaque white and encode as a 1-bit non-interlaced PNG.
 *
 * `rgba` is resvg's raw pixel buffer: 4 bytes per pixel, top-left origin, no
 * row padding. The scanline filter is 0 (None) on every row — at one bit per
 * pixel the rows are already long runs of 0xFF, which deflate collapses, and
 * the sub-byte filtering rules are a place to be subtly wrong for no gain.
 */
export async function encodeMonochromePng(
  rgba: Uint8Array,
  width: number,
  height: number,
  /** Rows [fromRow, fromRow + rowCount) only. Defaults to the whole image. */
  fromRow = 0,
  rowCount = height,
): Promise<Uint8Array> {
  const expected = width * height * 4;
  if (rgba.length < expected) {
    throw new Error(
      `pixel buffer is ${rgba.length} bytes, expected ${expected} for ${width}x${height} RGBA`,
    );
  }
  if (fromRow < 0 || rowCount <= 0 || fromRow + rowCount > height) {
    throw new Error(
      `row range ${fromRow}..${fromRow + rowCount} is outside a ${height}-row image`,
    );
  }

  // Each scanline is one filter byte followed by ceil(width/8) packed bytes.
  const stride = monoStride(width);
  const raw = new Uint8Array((stride + 1) * rowCount);

  for (let row = 0; row < rowCount; row++) {
    const rowStart = row * (stride + 1);
    raw[rowStart] = 0; // filter: None
    const dst = rowStart + 1;
    let src = (fromRow + row) * width * 4;
    for (let x = 0; x < width; x++) {
      // The buffer starts zeroed, and 0 is black — so only paper sets a bit.
      // MSB first: pixel 0 is bit 7 of the first byte.
      if (!isInk(rgba[src], rgba[src + 1], rgba[src + 2], rgba[src + 3])) {
        raw[dst + (x >> 3)] |= 0x80 >> (x & 7);
      }
      src += 4;
    }
    // Trailing bits of the last byte are padding. The spec says decoders
    // ignore them; set them to paper anyway, so firmware that does not mask
    // them prints a white margin rather than a black bar down the edge.
    const slack = stride * 8 - width;
    if (slack > 0) raw[dst + stride - 1] |= (1 << slack) - 1;
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, rowCount);
  ihdr[8] = 1; // bit depth: 1
  ihdr[9] = 0; // colour type 0 = greyscale, no alpha
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  const idat = await deflate(raw);

  const parts = [
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}
