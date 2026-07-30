// Named imports, not a default: opentype.js v2's ESM build (dist/opentype.mjs)
// has no default export, and Turbopack resolves the ESM entry. `import
// opentype from "opentype.js"` type-checks against @types and works under tsx
// (which takes the CJS entry), then fails the production build.
import { parse, type Font } from "opentype.js";
import { loadTicketFonts } from "@/lib/ticket/font";

/**
 * Text measurement for the kitchen ticket, in pure JS.
 *
 * This replaces satori's yoga layout engine. satori@0.29.0 inlines the
 * Emscripten build of yoga-layout as a base64 data URI and instantiates those
 * BYTES at runtime, which workerd forbids ("Wasm code generation disallowed by
 * embedder"), and its `init()` export is a no-op so there is no way to hand it
 * a pre-compiled module. A kitchen ticket is a fixed-width vertical receipt; it
 * needs advance widths and a wrap rule, not a CSS layout engine.
 *
 * WHY opentype.js AND NOT fontkit: fontkit pulls eight transitive dependencies
 * including a brotli decompressor (for WOFF2, which we do not use) and
 * unicode-trie. opentype.js has ZERO dependencies and is plain ESM, which is
 * the whole point on a runtime we just finished stripping wasm out of. Both
 * parse the subset cleanly; this one costs less.
 *
 * Measurement reads the SAME buffers resvg rasterizes with, so what we measure
 * is what gets drawn — the metrics cannot drift from the rendering.
 */

/** The two weights the subset font ships. */
export type Weight = 400 | 700;

/** Advance widths are cached per codepoint, per weight — the subset is small. */
interface WeightMetrics {
  font: Font;
  /** codepoint -> advance in EM units (advanceWidth / unitsPerEm). */
  advances: Map<number, number>;
  /** Codepoints resolved to .notdef, i.e. absent from the subset's cmap. */
  missing: Set<number>;
}

export interface TicketMetrics {
  /** Rendered width of `text` at `fontSize`, in px. */
  measure(text: string, fontSize: number, weight: Weight): number;
  /**
   * Break `text` so no line exceeds `maxWidth`. CJK breaks per character;
   * Latin breaks on spaces, with a per-character fallback for tokens too long
   * to fit a line on their own.
   */
  wrap(text: string, fontSize: number, weight: Weight, maxWidth: number): string[];
  /** Codepoints in `text` that the subset cannot draw. */
  missingIn(text: string, weight: Weight): number[];
  /** Font ascent as a multiple of the font size. */
  ascent: number;
  /** Font descent (positive) as a multiple of the font size. */
  descent: number;
}

/**
 * A codepoint absent from the subset still has to be measurable — the layout
 * must not collapse because one glyph is missing. .notdef's own advance is what
 * resvg will actually draw, so using it keeps the box and the ink agreeing.
 */
const FALLBACK_ADVANCE_EM = 1;

/**
 * Characters that may break on either side.
 *
 * CJK ideographs, kana, Hangul, CJK punctuation and the fullwidth forms. This
 * is deliberately a range test rather than a full UAX #14 implementation: the
 * ticket sets 中文 item names and short 中文 labels, and a line-breaking
 * algorithm with more opinions than that would be more code to be wrong in.
 */
function breaksAnywhere(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x11ff) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303f) || // CJK radicals, Kangxi, CJK punctuation
    (cp >= 0x3040 && cp <= 0x30ff) || // kana
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified
    (cp >= 0xac00 && cp <= 0xd7af) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility
    (cp >= 0xff00 && cp <= 0xffef) // fullwidth forms
  );
}

function parseWeight(buffer: ArrayBuffer): WeightMetrics {
  return {
    font: parse(buffer),
    advances: new Map(),
    missing: new Set(),
  };
}

/** Advance for one codepoint, in EM units. Records absence as a side effect. */
function advanceEm(w: WeightMetrics, cp: number): number {
  const cached = w.advances.get(cp);
  if (cached !== undefined) return cached;

  const glyph = w.font.charToGlyph(String.fromCodePoint(cp));
  // index 0 is .notdef — the character is not in this subset.
  const absent = !glyph || glyph.index === 0;
  if (absent) w.missing.add(cp);
  const units = glyph?.advanceWidth;
  const em =
    typeof units === "number" && units > 0
      ? units / w.font.unitsPerEm
      : FALLBACK_ADVANCE_EM;

  w.advances.set(cp, em);
  return em;
}

let cached: TicketMetrics | null = null;

/**
 * Parse the subset fonts and build the measurer. Cached per isolate — the
 * parse is the only expensive part and a warm isolate pays it once.
 */
export async function loadTicketMetrics(): Promise<TicketMetrics> {
  if (cached) return cached;

  const fonts = await loadTicketFonts();
  const byWeight: Record<Weight, WeightMetrics> = {
    400: parseWeight(fonts.regular),
    700: parseWeight(fonts.bold),
  };

  // Both weights are the same subset at the same upem, so either is
  // authoritative for the vertical metrics.
  const ref = byWeight[400].font;
  const upem = ref.unitsPerEm;

  /**
   * Coerce to a string before ANY `for…of`.
   *
   * `for (const ch of text)` over a non-string throws "text is not iterable" —
   * which, minified, is the bare identifier that took production down when a
   * hand-written `items` JSONB omitted nameEn. The renderer normalizes shape at
   * its entry (see normalizeOrder), and this is the second line of defence:
   * nothing reaching a measurement primitive should be able to throw on type.
   */
  const str = (text: unknown): string =>
    typeof text === "string" ? text : text == null ? "" : String(text);

  const measure = (raw: string, fontSize: number, weight: Weight): number => {
    const text = str(raw);
    const w = byWeight[weight];
    let em = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp === undefined) continue;
      em += advanceEm(w, cp);
    }
    return em * fontSize;
  };

  /** Split into atoms: one per CJK char, one per whitespace run, one per word. */
  const atomize = (text: string): string[] => {
    const atoms: string[] = [];
    let word = "";
    const flush = () => {
      if (word) atoms.push(word);
      word = "";
    };
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0;
      if (ch === " " || ch === "\t") {
        flush();
        atoms.push(" ");
      } else if (breaksAnywhere(cp)) {
        flush();
        atoms.push(ch);
      } else {
        word += ch;
      }
    }
    flush();
    return atoms;
  };

  /** Hard-break one over-long atom into chunks that each fit. */
  const shatter = (
    atom: string,
    fontSize: number,
    weight: Weight,
    maxWidth: number,
  ): string[] => {
    const out: string[] = [];
    let chunk = "";
    for (const ch of atom) {
      const next = chunk + ch;
      if (chunk && measure(next, fontSize, weight) > maxWidth) {
        out.push(chunk);
        chunk = ch;
      } else {
        chunk = next;
      }
    }
    if (chunk) out.push(chunk);
    return out;
  };

  const wrapInner = (
    text: string,
    fontSize: number,
    weight: Weight,
    maxWidth: number,
  ): string[] => {
    // Honour hard newlines first; each is wrapped independently.
    const paragraphs = text.split("\n");
    const lines: string[] = [];

    for (const paragraph of paragraphs) {
      let line = "";
      const push = () => {
        const trimmed = line.replace(/\s+$/, "");
        if (trimmed) lines.push(trimmed);
        line = "";
      };

      for (const atom of atomize(paragraph)) {
        // A space never starts a line.
        if (atom === " " && line === "") continue;

        const candidate = line + atom;
        if (measure(candidate, fontSize, weight) <= maxWidth) {
          line = candidate;
          continue;
        }

        // Does not fit. Close the current line and try the atom alone.
        push();
        if (atom === " ") continue;

        if (measure(atom, fontSize, weight) <= maxWidth) {
          line = atom;
        } else {
          // Single atom wider than the column — break it by character. Every
          // chunk but the last is a finished line.
          const chunks = shatter(atom, fontSize, weight, maxWidth);
          for (let i = 0; i < chunks.length - 1; i++) lines.push(chunks[i]);
          line = chunks[chunks.length - 1] ?? "";
        }
      }
      push();
    }

    // Never return zero lines for non-empty input: an empty result would
    // silently drop the string from the ticket.
    return lines.length > 0 ? lines : [""];
  };

  const wrap = (
    raw: string,
    fontSize: number,
    weight: Weight,
    maxWidth: number,
  ): string[] => wrapInner(str(raw), fontSize, weight, maxWidth);

  const missingIn = (raw: string, weight: Weight): number[] => {
    const text = str(raw);
    const w = byWeight[weight];
    const out: number[] = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp === undefined) continue;
      advanceEm(w, cp); // populates w.missing
      if (w.missing.has(cp) && !out.includes(cp)) out.push(cp);
    }
    return out;
  };

  cached = {
    measure,
    wrap,
    missingIn,
    ascent: ref.ascender / upem,
    descent: Math.abs(ref.descender) / upem,
  };
  return cached;
}
