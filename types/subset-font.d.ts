/**
 * Minimal types for `subset-font`, which ships none.
 *
 * Only the surface scripts/build-ticket-font.ts uses is modelled — the package
 * is a build-time dependency and never reaches the app bundle.
 */
declare module "subset-font" {
  interface VariationAxisRange {
    min?: number;
    max?: number;
    default?: number;
  }

  interface SubsetFontOptions {
    targetFormat?: "sfnt" | "truetype" | "woff" | "woff2";
    /** Pin or restrict variable-font axes, e.g. { wght: { default: 700 } }. */
    variationAxes?: Record<string, VariationAxisRange>;
    preserveNameIds?: number[];
  }

  /** Subset `font` to the glyphs needed to render `text`. */
  export default function subsetFont(
    font: Buffer,
    text: string,
    options?: SubsetFontOptions,
  ): Promise<Buffer>;
}
