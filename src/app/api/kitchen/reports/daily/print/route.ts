import { publicTenant } from "@/config/tenant.server";
import { previewOrderingBlocked } from "@/lib/http/deployHost";
import { stationPrinterHealth } from "@/lib/kitchen/boardFeed";
import { readDailyReport } from "@/lib/reports/daily";
import { reportProblems } from "@/lib/reports/dailyModel";
import { isMissingReportTable, requestReportPrint } from "@/lib/reports/prints";
import { PrintBodySchema, parseReportDate, printerBlocked, sheetGuard } from "@/lib/reports/sheet";

/**
 * POST /api/kitchen/reports/daily/print
 *   { date, station, blocks, sequence, requestKey }
 *
 * Queue ONE 日結 print. Idempotent on (tenant, date, sequence): the same
 * requestKey again answers the print it already made; a #N someone else
 * already printed answers 409 with the next #N, and the sheet refreshes.
 * The numbers are summed NOW and stored with the request, so the paper is the
 * report as of this press. The printer collects it on its next poll, after any
 * ticket it is owed; it is offered once and never retried (lib/reports/prints).
 *
 * Staff-session only, and only on the production or a local host, like every
 * other route that puts paper in the kitchen.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const blocked = previewOrderingBlocked(request);
  if (blocked) return blocked;
  const denied = sheetGuard(request);
  if (denied) return denied;

  let body;
  try {
    body = PrintBodySchema.parse(await request.json());
  } catch {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const tenant = publicTenant();
  const day = parseReportDate(body.date, tenant.timezone);
  if (!day.ok) return Response.json({ ok: false, error: day.error }, { status: 400 });

  try {
    const printer = printerBlocked(await stationPrinterHealth(tenant.tenantId), body.station);
    if (printer) {
      return Response.json(
        { ok: false, error: "printer unavailable", reason: printer.health },
        { status: 409 },
      );
    }

    const report = await readDailyReport({
      tenantId: tenant.tenantId,
      businessDate: day.date,
      timezone: tenant.timezone,
    });
    const problems = reportProblems(report);
    if (problems.length > 0) {
      // Never print numbers that do not add up. Should be unreachable: the
      // aggregate adds every bucket into its column and All once each.
      console.error(`[daily-report] ${day.date} does not add up, not printing:`, problems.join("; "));
      return Response.json({ ok: false, error: "report does not add up" }, { status: 500 });
    }

    const result = await requestReportPrint({
      tenantId: tenant.tenantId,
      businessDate: day.date,
      station: body.station,
      blocks: body.blocks,
      report,
      sequence: body.sequence,
      requestKey: body.requestKey,
    });
    if (result.kind === "conflict") {
      return Response.json(
        { ok: false, error: "sequence taken", nextSequence: result.nextSequence },
        { status: 409 },
      );
    }
    const p = result.print;
    console.info(
      `[daily-report] ${result.kind} ${p.businessDate} #${p.sequence} for ${p.station} ` +
        `code ${p.code}: ${p.report.columns.all.count} orders`,
    );
    return Response.json({
      ok: true,
      replay: result.kind === "replay",
      print: { sequence: p.sequence, station: p.station, status: p.status, code: p.code },
    });
  } catch (err) {
    if (isMissingReportTable(err)) {
      return Response.json({ ok: false, error: "printing reports is not set up yet" }, { status: 503 });
    }
    console.error("[daily-report] print failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ ok: false, error: "Could not queue the print." }, { status: 503 });
  }
}
