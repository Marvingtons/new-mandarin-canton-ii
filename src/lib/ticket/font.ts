import {
  TICKET_FONT_BOLD_B64,
  TICKET_FONT_CODEPOINTS,
  TICKET_FONT_REGULAR_B64,
} from "@/lib/ticket/font-data";

/**
 * The subset Noto Sans TC the kitchen ticket renders with.
 *
 * Previously read off disk with `readFile(join(process.cwd(), "public/fonts",
 * …))` and traced into the lambda by next.config's outputFileTracingIncludes.
 * Neither exists on Cloudflare Workers: no filesystem, no file tracing. The
 * bytes are now compiled into the bundle (see font-data.ts) and decoded once
 * per isolate.
 *
 * Decoded lazily and cached in module scope, so a warm isolate pays the
 * base64 decode exactly once. Still async, so every caller's `await` and the
 * whole call graph above it are unchanged.
 */

export interface TicketFonts {
  regular: ArrayBuffer;
  bold: ArrayBuffer;
  /** Codepoints the subset can actually draw. */
  coverage: Set<number>;
}

/**
 * base64 -> bytes, without Buffer.
 *
 * `atob` is available on workerd and in modern Node, and avoids depending on
 * nodejs_compat for something this small. Buffer.from(b64, "base64") would
 * work under the flag, but the renderer is the one part of this app that must
 * not acquire an avoidable runtime dependency.
 */
function decodeBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

let cached: TicketFonts | null = null;

export async function loadTicketFonts(): Promise<TicketFonts> {
  if (cached) return cached;

  cached = {
    regular: decodeBase64(TICKET_FONT_REGULAR_B64),
    bold: decodeBase64(TICKET_FONT_BOLD_B64),
    coverage: new Set(TICKET_FONT_CODEPOINTS),
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
