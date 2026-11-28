import { isStation } from "@/config/stations";
import { publicTenant } from "@/config/tenant.server";
import { readDailyReport } from "@/lib/reports/daily";
import { parseReportDate, sheetGuard } from "@/lib/reports/sheet";
import { renderReportPng } from "@/lib/ticket/report";

/**
 * GET /api/kitchen/reports/daily/preview?date=&station=&sequence=
 *
 * The sheet's live preview: the report as the printer's own 1-bit PNG, drawn
 * by the SAME renderer as the paper (lib/ticket/report.ts), so what the
 * tablet shows is what prints. `sequence` is the #N the print would carry.
 * Staff-session only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const denied = sheetGuard(request);
  if (denied) return denied;
  const tenant = publicTenant();
  const params = new URL(request.url).searchParams;
  const day = parseReportDate(params.get("date"), tenant.timezone);
  if (!day.ok) return Response.json({ ok: false, error: day.error }, { status: 400 });
  const station = params.get("station") ?? "store";
  if (!isStation(station)) return Response.json({ ok: false, error: "bad station" }, { status: 400 });
  const sequence = Number.parseInt(params.get("sequence") ?? "1", 10);
  if (!Number.isFinite(sequence) || sequence < 1 || sequence > 999) {
    return Response.json({ ok: false, error: "bad sequence" }, { status: 400 });
  }
  try {
    const report = await readDailyReport({
      tenantId: tenant.tenantId,
      businessDate: day.date,
      timezone: tenant.timezone,
    });
    const { png } = await renderReportPng(report, {
      printedAt: new Date().toISOString(),
      station,
      sequence,
      timezone: tenant.timezone,
    });
    return new Response(new Uint8Array(png), {
      headers: { "content-type": "image/png", "cache-control": "no-store", "x-report-code": report.code },
    });
  } catch (err) {
    console.error("[daily-report] preview failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ ok: false, error: "Could not draw the preview." }, { status: 503 });
  }
}
