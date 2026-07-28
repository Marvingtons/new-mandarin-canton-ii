import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Loads the subset Noto Sans TC that the kitchen ticket renders with.
 *
 * The font is committed under public/fonts (see scripts/build-ticket-font.ts).
 * next.config.ts traces it into the serverless bundle explicitly — `public/` is
 * served statically, which is NOT the same as being readable from the lambda
 * filesystem, and finding that out in production means blank tickets.
 *
 * Buffers are cached in module scope: a warm lambda reads the disk once.
 */

const FONT_DIR = join(process.cwd(), "public", "fonts");

export interface TicketFonts {
  regular: Buffer;
  bold: Buffer;
  /** Codepoints the subset can actually draw. */
  coverage: Set<number>;
}

let cached: TicketFonts | null = null;

export async function loadTicketFonts(): Promise<TicketFonts> {
  if (cached) return cached;

  const [regular, bold, coverageRaw] = await Promise.all([
    readFile(join(FONT_DIR, "NotoSansTC-Ticket-Regular.ttf")),
    readFile(join(FONT_DIR, "NotoSansTC-Ticket-Bold.ttf")),
    readFile(join(FONT_DIR, "ticket-font-coverage.json"), "utf8"),
  ]);

  const parsed = JSON.parse(coverageRaw) as { codepoints: number[] };
  cached = {
    regular,
    bold,
    coverage: new Set(parsed.codepoints),
  };
  return cached;
}

/**
 * Can every character of `text` actually be drawn?
 *
 * This is the guard that keeps a forgotten `npm run build:ticket-font` from
 * printing empty boxes on the kitchen's only copy of an order. Callers treat a
 * false here exactly like a missing translation: fall back to English and mark
 * it visibly.
 */
export function isPrintable(text: string, coverage: Set<number>): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (!coverage.has(cp)) return false;
  }
  return true;
}
