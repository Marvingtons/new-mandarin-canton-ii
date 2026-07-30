/**
 * A minimal PNG encoder for thermal print jobs.
 *
 * WHY NOT resvg's own asPng(): it always emits colour type 6 — 8-bit
 * truecolour WITH an alpha channel — and the Star TSP143IV answers such a job
 * with `code=511 Media Decoding Error`. Delivery is fine; the file arrives
 * whole. The firmware simply will not decode a 32-bit RGBA PNG. Star's own
 * format notes name "1 bit per pixel" and "24/32bit per pixel" images, and
 * 24-bit truecolour (colour type 2) is the variant they name for colour PNG
 * data, so that is what this emits.
 *
 * The alpha channel was always redundant here. The renderer already paints an
 * opaque white background, so every pixel is at full opacity — the channel
 * carried 1 byte per pixel of the value 255 and nothing else.
 *
 * CONSTRAINTS THIS FILE HONOURS, all of them things the printer cares about:
 *   - 8 bits per sample, colour type 2 (RGB). No alpha, no palette.
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

/**
 * Composite RGBA over opaque white and encode as a 24-bit non-interlaced PNG.
 *
 * `rgba` is resvg's raw pixel buffer: 4 bytes per pixel, top-left origin, no
 * row padding. The scanline filter is 0 (None) on every row — the rows are
 * mostly long runs of identical white, which deflate already collapses, and a
 * predictor would cost CPU on a wasm-rendered raster for no useful gain.
 */
export async function encodeOpaqueRgbPng(
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

  // Each scanline is one filter byte followed by width RGB triples.
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: None
    let src = y * width * 4;
    let dst = rowStart + 1;
    for (let x = 0; x < width; x++) {
      const a = rgba[src + 3];
      if (a === 255) {
        raw[dst] = rgba[src];
        raw[dst + 1] = rgba[src + 1];
        raw[dst + 2] = rgba[src + 2];
      } else {
        // Source-over onto white. The renderer paints an opaque background so
        // this is the rare path, but a partially transparent pixel must land
        // on white rather than be truncated to its own colour.
        const alpha = a / 255;
        raw[dst] = Math.round(rgba[src] * alpha + 255 * (1 - alpha));
        raw[dst + 1] = Math.round(rgba[src + 1] * alpha + 255 * (1 - alpha));
        raw[dst + 2] = Math.round(rgba[src + 2] * alpha + 255 * (1 - alpha));
      }
      src += 4;
      dst += 3;
    }
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour, no alpha
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
