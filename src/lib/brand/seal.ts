/**
 * THE MARK — the FU YUAN seal's geometry, in one place.
 *
 * Lifted verbatim from public/brand/fu-yuan-seal.svg, which is itself the
 * mark cropped out of the official logo artwork (public/fu-yuan-logo.svg)
 * with the wordmark omitted. That file stays the source of truth on disk —
 * the icon and OG generators read it with node:fs at build time — and this
 * module is the same geometry for the things that cannot read a file: the
 * two components that must INLINE the mark to animate or recolour it.
 *
 * Consumers: Seal.tsx (the mark everywhere it appears at rest) and
 * LoadingOverlay.tsx (the stamp, which strokes the frame on and needs the
 * path in JS to measure it).
 *
 * ARTWORK ANATOMY, as measured rather than as assumed. In the full logo:
 *   cls-1   ONE path, the bracket frame, stroke #DEAE64, 410.3 user units
 *           long. There is no crane in it.
 *   cls-2   TEN paths — 富 (4) AND 源 (6), both characters, fill #EABD62.
 *   cls-3   THREE <line> elements, stroke #DEB166, flanking the wordmark.
 *   cls-4   28 elements, the "NEW MANDARIN CANTON II" wordmark BELOW the
 *           frame (y 158-178), fill #DA9F52. Not part of the mark.
 *   cls-0   declared #77151A and used by NOTHING. The artwork carries no
 *           red ground; the stamp synthesises one by filling FRAME_D.
 */

/** The mark's box: frame + both characters, wordmark cropped away. */
export const VIEWBOX_FULL = "32.5 8.5 80 141.5";
/** Below ~32px the full mark turns to mud, so small crops to 富 alone. */
export const VIEWBOX_SMALL = "46.3 17.9 52.4 59.5";

/** The bracket frame (cls-1). Stroked, never filled, in the artwork. */
export const FRAME_D =
  "m110.6 19c-3.4-1.4-8.6-4.5-9.3-8.6h-57.6c-0.6 4.1-5.1 8.8-9.4 9.3l-0.1 118.8c3.8 0.6 8.7 3.7 9.5 9.5h58.7c0.7-4.8 4.6-8.5 9.2-9.3l-1-119.7z";

/**
 * Measured with getTotalLength() on the mounted path, in USER UNITS, so
 * it holds at any rendered size. The stamp's draw uses it for
 * stroke-dasharray/offset; re-measure if FRAME_D ever changes.
 */
export const FRAME_LENGTH = 410.3;

/** 富 — paths 1-4 of the artwork's cls-2. */
export const FU_DS = [
  "m97.7 26.9-5.4-3.7-2.8 2.8h-15l0.7-1c3.9-5.1-3.3-7.1-6.8-6.5l-0.4 0.4c1.7 1.6 2.3 3.9 2.3 6.9h-15.5c-0.5-0.9-1.1-1.9-2-2.6-0.2 3-1.6 6-4.5 7.8-2.3 1.4-2 5.4 1.5 5.4s5.4-4.8 5-8.8h35.6l-1.8 6.5 0.4 0.3 5.8-4.4 2.9-0.3c0.7 0 0.4 0.2 0.4-2.8z",
  "m88.4 32.7-5.6-4-1.1 1.2-2.1 2.5h-16.3l-5.6-0.3 1 2.6 5.3-0.7h23.1z",
  "m83.6 36.4-2.7 2.8h-16.6l-5.9-2.3h-0.1c0.5 4.7 0.1 11.1 0.1 13.5s5.6-0.2 5.6-1v-1.2h17.1v1.5c0 2.3 5.6-0.6 5.5-1.4-0.2-1.4 0-6.2 0-6.2s3.7-1.2 1.4-2.4zm-2.5 10.3h-17.1v-5.9h17.2v5.9z",
  "m88.6 50.7-2.8 2.9h-27l-5.8-2.4c0.6 6.3 0.1 19.7 0.1 23.9s5.4-0.2 5.4-1.6v-2.3h27.6v3.4c-0.4 2.5 5.6 0.1 5.5-1.9-0.1-2.3-0.2-16.3-0.2-16.3l1.9-0.9 0.3-0.8zm-19.2 19h-10.8v-7.1h10.9zm0.1-8.7h-10.9v-6h10.9zm16.4 8.6h-11v-7h11zm0.1-8.2h-11.2v-6.4h11.2z",
];

/** 源 — paths 5-10 of the artwork's cls-2. */
export const YUAN_DS = [
  "m59.1 88.8c-0.5-4.2-8.1-5.6-9.4-5.6-0.4 0-0.6 0.5 0 0.9 1.8 2.2 3.4 4.4 4.2 7.9 2 3.4 5.7 0 5.2-3.2z",
  "m45.7 96.7c-0.1 0.3-0.1 0.4 0.2 0.7 1.8 2.1 3.5 5.1 4.2 8.1 2.2 3.4 7.3-1.1 4.5-5-2.6-3-7.6-3.9-8.9-3.8z",
  "m60 98.2-9.6 21.7-4.2-0.5 0.1 1c3.7 1 4 3.9 2.8 9.5-0.8 2.8-0.4 7 3.5 6.5 2.2-0.5 3.3-3.3 3-6-0.5-3-0.9-6.5-0.5-8.9 0.7-4.9 5.2-22.5 5.2-23z",
  "m97.2 86.1-4.6-3.6-0.9 0.4-2.8 3.3h-20.5l-5.8-2.5c0.3 3.4 0.3 14.9 0.3 18.8-0.3 13.9-2.5 25.9-7.7 34.1l0.4 0.2c8.1-7.4 12.3-16.2 12.3-36.7v-12.2h10.4 0.2-0.3 0.2c0.3 0.7-0.1 5.8-1 8.1h-1l-5.3-2.3c0.3 2.9 0.3 15.9 0 21.3 0 2.2 5.1 0.1 5.1-1v-0.8h2.9c0.3 0.1 0.3 0.2 0.3 0.9v14.8c0 3.1-3.3 1.6-6.6 1.7l0.1 1c3.2 0.5 4.5 2.6 4.3 4.3s1.5 1.5 3.8 0.7c2.2-0.9 3.7-2.2 3.7-5.2v-17.7c0-0.3 0.1-0.5 0.3-0.6h3.6v2c0 2 5.2-0.6 5.1-1.6-0.2-0.9-0.1-14.9-0.1-14.9l1.6-1.1 0.3-0.8-4.9-3.8-2.7 3.1h-8.2l3.9-5.3 1.8-0.3 0.2-0.8-3.7-1.7h15.5c0.2 0 0.2-0.9-0.2-0.9zm-8.7 25.4h-12.3v-6.4h12.3zm0-7.8h-12.4v-6.3h12.4z",
  "m71.8 117.5c-2.1 6.2-5.6 11.9-8.2 16l0.3 0.2c3.2-1.3 9.5-7.2 11.7-11.3 3.8-0.4 1-3.4-3.8-4.9z",
  "m87.1 118-0.2 0.7c2.8 3.3 5 7.4 5.5 12.3 0.2 2.6 4.2 2.7 5-1.4 1.6-6.9-7.8-11.1-10.3-11.6z",
];

/**
 * The seal's own palette, straight off the artwork. These are hex rather
 * than tokens on purpose: they are what the ARTWORK is, and the site's
 * tokens are reconciled TO them (see the palette block in globals.css),
 * not the other way round.
 */
export const SEAL_GOLD_STROKE = "#DEAE64";
export const SEAL_GOLD_FILL = "#EABD62";
/** cls-0: declared in the artwork, drawn by nothing. The stamp's ground. */
export const SEAL_RED = "#77151A";
