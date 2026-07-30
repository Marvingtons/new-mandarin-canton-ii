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
): Promise<Uint8Array> {
  const expected = width * height * 4;
  if (rgba.length < expected) {
    throw new Error(
      `pixel buffer is ${rgba.length} bytes, expected ${expected} for ${width}x${height} RGBA`,
    );
  }

  // Each scanline is one filter byte followed by ceil(width/8) packed bytes.
  const stride = monoStride(width);
  const raw = new Uint8Array((stride + 1) * height);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: None
    const dst = rowStart + 1;
    let src = y * width * 4;
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
  view.setUint32(4, height);
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
