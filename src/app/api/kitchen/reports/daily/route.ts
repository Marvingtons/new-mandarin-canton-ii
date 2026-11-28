import { publicTenant } from "@/config/tenant.server";
import { loadSheet, parseReportDate, parseScope, sheetGuard } from "@/lib/reports/sheet";

/**
 * GET /api/kitchen/reports/daily[?date=YYYY-MM-DD][&scope=all|online|store]
 *
 * The 日結 report for one business day as JSON, with what the print sheet
 * needs around it: the next #N, the day's earlier prints, and each printer's
 * health. A read, so idempotent by nature. Staff-session only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const denied = sheetGuard(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const day = parseReportDate(params.get("date"), publicTenant().timezone);
  if (!day.ok) return Response.json({ ok: false, error: day.error }, { status: 400 });
  const scope = parseScope(params.get("scope"));
  if (!scope) return Response.json({ ok: false, error: "bad scope" }, { status: 400 });
  try {
    return Response.json(await loadSheet(day.date, new Date(), scope), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[daily-report] read failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ ok: false, error: "Could not load the report." }, { status: 503 });
  }
}
