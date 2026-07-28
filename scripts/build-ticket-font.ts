/**
 * Build the subset Noto Sans TC used by the kitchen ticket.
 *
 *   npm run build:ticket-font -- /path/to/NotoSansTC[wght].ttf
 *
 * The upstream variable font is ~12 MB, which would blow the serverless bundle
 * on its own. We pin two weight instances and keep only the glyphs
 * src/lib/ticket/glyphs.ts can actually produce, which lands in the low tens of
 * kilobytes.
 *
 * Outputs, all committed:
 *   public/fonts/NotoSansTC-Ticket-Regular.ttf
 *   public/fonts/NotoSansTC-Ticket-Bold.ttf
 *   public/fonts/ticket-font-coverage.json   (what the renderer may print)
 *
 * Re-run this whenever 中文 is added anywhere that reaches a ticket.
 *
 * Source font: https://github.com/google/fonts/raw/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf
 * SIL Open Font License 1.1 — redistribution of a subset is permitted.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import subsetFont from "subset-font";
import { collectTicketGlyphs } from "../src/lib/ticket/glyphs";

const OUT_DIR = join(process.cwd(), "public", "fonts");

const WEIGHTS = [
  { name: "Regular", wght: 400 },
  { name: "Bold", wght: 700 },
];

async function main(): Promise<void> {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    console.error(
      "Usage: npm run build:ticket-font -- <path to NotoSansTC[wght].ttf>\n" +
        "Download it from:\n" +
        "  https://github.com/google/fonts/raw/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf",
    );
    process.exit(1);
  }

  const source = await readFile(sourcePath);
  const glyphs = collectTicketGlyphs();
  const codepoints = [...glyphs].map((ch) => ch.codePointAt(0) as number);

  console.log(
    `source: ${(source.length / 1024 / 1024).toFixed(2)} MB` +
      `  ·  glyphs requested: ${codepoints.length}`,
  );

  await mkdir(OUT_DIR, { recursive: true });

  let total = 0;
  for (const weight of WEIGHTS) {
    const subset = await subsetFont(source, glyphs, {
      targetFormat: "truetype",
      // Pin the variable axis so the output is a plain static font. Satori
      // renders variable fonts at their default instance only, so a "bold"
      // that is really wght-400 would silently look identical to regular.
      variationAxes: { wght: { min: weight.wght, max: weight.wght, default: weight.wght } },
    });

    const file = join(OUT_DIR, `NotoSansTC-Ticket-${weight.name}.ttf`);
    await writeFile(file, subset);
    total += subset.length;
    console.log(
      `  ${weight.name.padEnd(8)} ${(subset.length / 1024).toFixed(1).padStart(7)} KB  ->  ${file}`,
    );
  }

  // The renderer reads this to decide whether a 中文 string is printable. A
  // character outside the subset falls back to English with a marker rather
  // than rendering as an empty box on the kitchen's only copy of the order.
  const coverageFile = join(OUT_DIR, "ticket-font-coverage.json");
  await writeFile(
    coverageFile,
    JSON.stringify(
      {
        note:
          "Codepoints present in the subset ticket font. Regenerate with " +
          "`npm run build:ticket-font` after adding any 中文 that reaches a ticket.",
        codepoints: codepoints.sort((a, b) => a - b),
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`  coverage ${String(codepoints.length).padStart(7)} cp  ->  ${coverageFile}`);
  console.log(`\ntotal committed font weight: ${(total / 1024).toFixed(1)} KB`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
