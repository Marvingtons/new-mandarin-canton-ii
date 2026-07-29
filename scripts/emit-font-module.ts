/**
 * Emit src/lib/ticket/font-data.ts from the committed subset TTFs.
 *
 *   npm run build:font-module
 *
 * Run automatically as the tail of `npm run build:ticket-font`, so the
 * embedded copy can never drift from the subset it was generated with.
 *
 * WHY THIS EXISTS: Cloudflare Workers have no filesystem. The renderer used to
 * do `readFile(join(process.cwd(), "public/fonts", ...))`, which cannot work
 * on workerd. Embedding the bytes as base64 is the one representation that
 * loads identically under workerd AND under plain Node — no wrangler module
 * rules, no bundler-specific import attributes, no cold-start fetch.
 */

import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FONT_DIR = join(process.cwd(), "public", "fonts");
const OUT = join(process.cwd(), "src", "lib", "ticket", "font-data.ts");

async function main(): Promise<void> {
  const [regular, bold, coverageRaw] = await Promise.all([
    readFile(join(FONT_DIR, "NotoSansTC-Ticket-Regular.ttf")),
    readFile(join(FONT_DIR, "NotoSansTC-Ticket-Bold.ttf")),
    readFile(join(FONT_DIR, "ticket-font-coverage.json"), "utf8"),
  ]);
  const coverage = (JSON.parse(coverageRaw) as { codepoints: number[] })
    .codepoints;

  const ttfKb = Math.round((regular.length + bold.length) / 1024);

  const lines = [
    "// GENERATED FILE — do not edit by hand.",
    "// Produced by `npm run build:ticket-font` (see scripts/emit-font-module.ts).",
    "// Regenerate after adding any 中文 that can reach a ticket.",
    "//",
    "// WHY THE FONT IS EMBEDDED RATHER THAN READ FROM DISK:",
    "// Cloudflare Workers have no filesystem, so the renderer's old",
    '// readFile(join(process.cwd(), "public/fonts", ...)) cannot work there.',
    "// Base64 is the one representation that loads identically under workerd",
    "// and under plain Node (scripts/ticket-sample.ts), with no wrangler module",
    "// rules, no bundler import attributes, and no cold-start fetch.",
    "//",
    `// Cost: ~${ttfKb} KB of TTF becomes ~${Math.round((regular.length + bold.length) * (4 / 3) / 1024)} KB of base64, which gzips back down.`,
    "//",
    "// public/fonts/*.ttf stay committed — they are the source of truth and are",
    "// what the subsetter reads.",
    "",
    "/** Subset Noto Sans TC, regular weight. */",
    `export const TICKET_FONT_REGULAR_B64 =\n  "${regular.toString("base64")}";`,
    "",
    "/** Subset Noto Sans TC, bold weight. */",
    `export const TICKET_FONT_BOLD_B64 =\n  "${bold.toString("base64")}";`,
    "",
    "/** Codepoints the subset can actually draw. */",
    `export const TICKET_FONT_CODEPOINTS: number[] = ${JSON.stringify(coverage)};`,
    "",
  ];

  await writeFile(OUT, lines.join("\n"), "utf8");
  const written = await stat(OUT);
  console.log(
    `font-data.ts  ${(written.size / 1024).toFixed(1)} KB` +
      `  (from ${ttfKb} KB of TTF, ${coverage.length} codepoints)`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
