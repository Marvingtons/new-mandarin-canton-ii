/**
 * Render the 日結 DAILY REPORT for four fixture days through the real ticket
 * renderer, and check every number before it is drawn.
 *
 *   npm run report:sample
 *
 * Writes docs/daily-report/<day>.png (committed: they are the design review)
 * and fails if:
 *   - any report breaks an invariant (Online + Store = All on every row; the
 *     channels sum to All; subtotal + charges + tax + tip = the stored total;
 *     the hours sum to All), see reportProblems();
 *   - any laid-out line runs past its column or the paper;
 *   - any glyph had to be drawn as .notdef (the subset lacks it).
 *
 * No database: the days are built in scripts/fixtures/orders.ts through the
 * real catalogue and the reference model (summarizeDay). Phase 2's
 * verify:daily-report proves the SQL aggregate returns the same report.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { composeReportSvg, renderReportPng } from "../src/lib/ticket/report";
import { TICKET_WIDTH_PX } from "../src/lib/ticket/render";
import {
  familyDinnerItemIds,
  formatMoney,
  reportProblems,
  summarizeDay,
  topDishes,
} from "../src/lib/reports/dailyModel";
import { reportFixtureDays } from "./fixtures/orders";

const TIMEZONE = "America/Los_Angeles";
const PAD = 20;
const OUT = join(process.cwd(), "docs", "daily-report");

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const family = familyDinnerItemIds();
  let failures = 0;

  // The four days at 範圍 All, then the Saturday at Online only and Store only.
  const days = await reportFixtureDays();
  const runs = [
    ...days.map((day) => ({ day, scope: "all" as const, slug: day.slug })),
    { day: days[0], scope: "online" as const, slug: `${days[0].slug}-online` },
    { day: days[0], scope: "store" as const, slug: `${days[0].slug}-store` },
  ];
  for (const { day, scope, slug } of runs) {
    const report = summarizeDay(day.rows, {
      tenantId: "fixture",
      businessDate: day.businessDate,
      timezone: TIMEZONE,
      familyItemIds: family,
      scope,
    });

    const problems = reportProblems(report);
    const top = topDishes(report);
    const names = top.map((d) => d.name);
    if (new Set(names).size !== names.length) problems.push(`two Top lines share a name: ${names.join(", ")}`);

    const options = { ...day.print, timezone: TIMEZONE };
    const { lines, height } = await composeReportSvg(report, options);
    for (const l of lines) {
      if (l.width > l.column + 0.5) problems.push(`"${l.text}" is ${l.width.toFixed(1)}px in a ${l.column}px column`);
      if (PAD + l.x + l.width > TICKET_WIDTH_PX - PAD + 0.5) problems.push(`"${l.text}" runs past the paper`);
    }

    const { png, missing } = await renderReportPng(report, options);
    if (missing.length > 0) {
      problems.push(
        `drawn as .notdef (re-run npm run build:ticket-font): ${missing.map((cp) => String.fromCodePoint(cp)).join("")}`,
      );
    }
    const file = join(OUT, `${slug}.png`);
    await writeFile(file, png);

    const all = report.columns.all;
    console.log(
      `${problems.length ? "FAIL" : "ok  "} ${slug.padEnd(18)} ${String(all.count).padStart(3)} orders  ` +
        `${formatMoney(all.totalCents).padStart(10)}  cancelled ${report.cancelled.count}  ` +
        `unprinted ${report.unprinted.count}  ${height}px (${(height / 8).toFixed(0)}mm)  code ${report.code}`,
    );
    console.log(
      `       top: ${top.map((d) => `${d.name} ${d.quantity}`).join(" · ") || "none"}` +
        `  (from ${report.top.map((t) => `${t.itemId} ${t.quantity}`).join(", ")})`,
    );
    for (const p of problems) console.log(`       - ${p}`);
    failures += problems.length;
  }

  console.log(`\nPNGs in ${OUT}`);
  if (failures > 0) {
    console.error(`${failures} problem(s)`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
