/**
 * Render one stored day's 日結 report, as the sheet's preview and the printer
 * do, for browser tests.
 *
 *   DATABASE_URL=… npx tsx --conditions=react-server scripts/report-preview.ts <date> <sequence> <pngPath>
 *
 * Prints {"code", "count", "totalCents", "top", "height", "width", "missing"} as
 * JSON (`top`: the printed 熱賣 TOP lines, merged by dish)
 * and writes the PNG. Written when the preview route could not load resvg
 * under `next start` (fixed in src/lib/ticket/resvg.ts); kept because it hands
 * the spec the drawn numbers as JSON, from the same renderReportPng and the
 * same database.
 */
import { writeFile } from "node:fs/promises";

async function main(): Promise<void> {
  const [date, sequenceArg, pngPath] = process.argv.slice(2);
  const sequence = Number(sequenceArg);
  if (!date || !Number.isFinite(sequence) || !pngPath) {
    throw new Error("usage: report-preview.ts <date> <sequence> <pngPath>");
  }
  const { readDailyReport } = await import("../src/lib/reports/daily");
  const { renderReportPng } = await import("../src/lib/ticket/report");
  const { topDishes } = await import("../src/lib/reports/dailyModel");
  const timezone = "America/Los_Angeles";
  const report = await readDailyReport({ tenantId: "new-mandarin-canton", businessDate: date, timezone });
  const { png, height, missing } = await renderReportPng(report, {
    printedAt: new Date().toISOString(),
    station: "store",
    sequence,
    timezone,
  });
  await writeFile(pngPath, png);
  const width = png.readUInt32BE(16);
  process.stdout.write(
    JSON.stringify({
      code: report.code,
      count: report.columns.all.count,
      totalCents: report.columns.all.totalCents,
      top: topDishes(report).map((d) => ({ name: d.name, quantity: d.quantity })),
      height,
      width,
      missing,
    }) + "\n",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
