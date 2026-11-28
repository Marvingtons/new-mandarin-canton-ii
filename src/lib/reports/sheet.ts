import "server-only";

import { z } from "zod";
import { STATIONS, type Station } from "@/config/stations";
import { publicTenant } from "@/config/tenant.server";
import { hasKitchenSessionFromRequest } from "@/lib/auth/kitchenSession";
import { isOrdersDbConfigured, ordersPool } from "@/lib/db/postgres";
import { stationPrinterHealth } from "@/lib/kitchen/boardFeed";
import type { StationPrinterHealth } from "@/lib/print/printerStatus";
import { readDailyReport } from "@/lib/reports/daily";
import {
  CHANNEL_SCOPES,
  defaultReportDate,
  isChannelScope,
  isReportDate,
  todayFor,
  type ChannelScope,
  type DailyReport,
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

/** 範圍 from a query string: all when absent, null when it is not a scope. */
export function parseScope(raw: string | null | undefined): ChannelScope | null {
  if (raw === null || raw === undefined || raw === "") return "all";
  return isChannelScope(raw) ? raw : null;
}

export const PrintBodySchema = z.strictObject({
  date: z.string(),
  station: z.enum(STATIONS),
  /** 範圍 SCOPE. Absent (an older page) = all. */
  scope: z.enum(CHANNEL_SCOPES).optional(),
  /**
   * Ignored. The sheet's optional-block toggles are gone (日結 v2: nothing on
   * the report is optional); a tablet still running the old page sends this,
   * and its print must not be refused for it.
   */
  blocks: z.unknown().optional(),
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
  /**
   * The printer the sheet preselects: the one that printed FEWER kitchen
   * tickets today (so the rolls wear evenly), the healthy one when the other
   * is blocked, store on a tie. Staff can still pick the other.
   */
  suggestedStation: Station;
  /** Kitchen tickets each printer confirmed today, the suggestion's basis. */
  ticketsToday: Record<Station, number>;
  /** False before migration 016: the sheet shows the numbers but cannot print. */
  printable: boolean;
}

/**
 * Kitchen tickets each printer confirmed on the restaurant's today: confirmed
 * order hand-overs (not reports), by the printer they went to, for orders of
 * today's business date.
 */
export async function ticketsPrintedToday(tenantId: string, today: string): Promise<Record<Station, number>> {
  const counts: Record<Station, number> = { online: 0, store: 0 };
  const { rows } = await ordersPool().query(
    `select d.station, count(*)::int as n
       from print_deliveries d
       join orders o on o.id = d.order_id and o.tenant_id = d.tenant_id
      where d.tenant_id = $1
        and o.business_date = $2::date
        and d.confirmed_at is not null
        and d.station is not null
      group by d.station`,
    [tenantId, today],
  );
  for (const r of rows) if (r.station === "online" || r.station === "store") counts[r.station as Station] = Number(r.n);
  return counts;
}

/** Fewer tickets wins; a blocked printer never; store on a tie. */
export function suggestStation(counts: Record<Station, number>, printers: readonly StationPrinterHealth[]): Station {
  const blocked = (s: Station) => printerBlocked(printers, s) !== null;
  if (blocked("store") && !blocked("online")) return "online";
  if (blocked("online") && !blocked("store")) return "store";
  return counts.online < counts.store ? "online" : "store";
}

export async function loadSheet(
  date: string,
  now: Date = new Date(),
  scope: ChannelScope = "all",
): Promise<ReportSheet> {
  const tenant = publicTenant();
  const today = todayFor(tenant.timezone, now);
  const [report, printers, ticketsToday] = await Promise.all([
    readDailyReport({ tenantId: tenant.tenantId, businessDate: date, timezone: tenant.timezone, channels: scope }),
    stationPrinterHealth(tenant.tenantId),
    ticketsPrintedToday(tenant.tenantId, today),
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
    today,
    defaultDate: defaultReportDate(tenant.timezone, now),
    report,
    nextSequence,
    prints,
    printers,
    suggestedStation: suggestStation(ticketsToday, printers),
    ticketsToday,
    printable,
  };
}
