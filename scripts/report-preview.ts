/**
 * Render one stored day's 日結 report, as the sheet's preview and the printer
 * do, for browser tests.
 *
 *   DATABASE_URL=… npx tsx --conditions=react-server scripts/report-preview.ts <date> <sequence> <pngPath>
 *
 * Prints {"code", "count", "totalCents", "height", "width", "missing"} as JSON
 * and writes the PNG. Exists because under `next start` the preview route
 * cannot load resvg (the Node-build gap kitchen-pos-required.spec.ts notes for
 * the ticket route; the Worker does not have it), so a spec renders here, the
 * same renderReportPng, against the same database.
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
  const timezone = "America/Los_Angeles";
  const report = await readDailyReport({ tenantId: "new-mandarin-canton", businessDate: date, timezone });
  const { png, height, missing } = await renderReportPng(report, {
    printedAt: new Date().toISOString(),
    station: "store",
    sequence,
    blocks: { trays: true, top: true, hours: true },
    timezone,
  });
  await writeFile(pngPath, png);
  const width = png.readUInt32BE(16);
  process.stdout.write(
    JSON.stringify({
      code: report.code,
      count: report.columns.all.count,
      totalCents: report.columns.all.totalCents,
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
