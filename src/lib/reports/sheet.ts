import "server-only";

import { z } from "zod";
import { STATIONS, type Station } from "@/config/stations";
import { publicTenant } from "@/config/tenant.server";
import { hasKitchenSessionFromRequest } from "@/lib/auth/kitchenSession";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import { stationPrinterHealth } from "@/lib/kitchen/boardFeed";
import type { StationPrinterHealth } from "@/lib/print/printerStatus";
import { readDailyReport } from "@/lib/reports/daily";
import {
  DEFAULT_BLOCKS,
  defaultReportDate,
  isReportDate,
  todayFor,
  type DailyReport,
  type ReportBlocks,
} from "@/lib/reports/dailyModel";
import {
  isMissingReportTable,
  listReportPrints,
  nextReportSequence,
  type ReportPrint,
} from "@/lib/reports/prints";

/**
 * The 日結 print sheet's server side, shared by its three routes under
 * /api/kitchen/reports/daily. Staff-session only, the same guard as every
 * other /api/kitchen route (and /kitchen itself).
 */

/** 401/503 before anything else, or null to carry on. */
export function sheetGuard(request: Request): Response | null {
  if (!hasKitchenSessionFromRequest(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isOrdersDbConfigured()) {
    return Response.json(
      { ok: false, error: "The order database is not configured (DATABASE_URL)." },
      { status: 503 },
    );
  }
  return null;
}

/**
 * The day asked for, or the error. Any past day; today; never the future
 * (the restaurant-local calendar, so a tablet in another zone cannot ask for
 * tomorrow). Absent = the day the sheet opens on: today, or yesterday before 4am.
 */
export function parseReportDate(
  raw: string | null | undefined,
  timezone: string,
  now: Date = new Date(),
): { ok: true; date: string } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, date: defaultReportDate(timezone, now) };
  }
  if (!isReportDate(raw)) return { ok: false, error: "bad date" };
  if (raw > todayFor(timezone, now)) return { ok: false, error: "future date" };
  return { ok: true, date: raw };
}

/** "trays,top" → { trays: true, top: true, hours: false }. Absent = all on. */
export function parseBlocks(raw: string | null | undefined): ReportBlocks {
  if (raw === null || raw === undefined) return { ...DEFAULT_BLOCKS };
  const on = new Set(raw.split(",").map((s) => s.trim()));
  return { trays: on.has("trays"), top: on.has("top"), hours: on.has("hours") };
}

export const PrintBodySchema = z.strictObject({
  date: z.string(),
  station: z.enum(STATIONS),
  blocks: z.strictObject({ trays: z.boolean(), top: z.boolean(), hours: z.boolean() }),
  /** The #N the sheet showed. */
  sequence: z.number().int().min(1).max(999),
  /** The client's key for this press of Print. */
  requestKey: z.string().min(8).max(100),
});

/** A printer that cannot take paper now, and why: the sheet's disabled reason. */
export function printerBlocked(printers: readonly StationPrinterHealth[], station: Station): StationPrinterHealth | null {
  const p = printers.find((x) => x.station === station);
  return p && p.blocked ? p : null;
}

/** What GET /api/kitchen/reports/daily answers. */
export interface ReportSheet {
  ok: true;
  date: string;
  /** The latest day ▶ may reach. */
  today: string;
  /** The day the sheet opens on. */
  defaultDate: string;
  report: DailyReport;
  /** The #N the next print of `date` will carry. */
  nextSequence: number;
  prints: Array<Pick<ReportPrint, "sequence" | "station" | "status" | "code" | "requestedAt" | "printedAt" | "lastError">>;
  printers: StationPrinterHealth[];
  /** False before migration 016: the sheet shows the numbers but cannot print. */
  printable: boolean;
}

export async function loadSheet(date: string, now: Date = new Date()): Promise<ReportSheet> {
  const tenant = publicTenant();
  const [report, printers] = await Promise.all([
    readDailyReport({ tenantId: tenant.tenantId, businessDate: date, timezone: tenant.timezone }),
    stationPrinterHealth(tenant.tenantId),
  ]);
  let nextSequence = 1;
  let prints: ReportSheet["prints"] = [];
  let printable = true;
  try {
    [nextSequence, prints] = await Promise.all([
      nextReportSequence(tenant.tenantId, date),
      listReportPrints(tenant.tenantId, date).then((rows) =>
        rows.map(({ sequence, station, status, code, requestedAt, printedAt, lastError }) => ({
          sequence, station, status, code, requestedAt, printedAt, lastError,
        })),
      ),
    ]);
  } catch (err) {
    if (!isMissingReportTable(err)) throw err;
    printable = false;
  }
  return {
    ok: true,
    date,
    today: todayFor(tenant.timezone, now),
    defaultDate: defaultReportDate(tenant.timezone, now),
    report,
    nextSequence,
    prints,
    printers,
    printable,
  };
}
