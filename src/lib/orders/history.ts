import { z } from "zod";
import {
  ORDER_CHANNELS,
  ORDER_STATUSES,
  type Order,
  type OrderChannel,
  type OrderStatus,
} from "@/lib/orders/types";
import { STATIONS, type Station } from "@/config/stations";

/**
 * Order history: the query, its wire form, and the date presets.
 *
 * TYPES + PURE HELPERS ONLY, so the history screen, the JSON route and the CSV
 * route all parse the SAME query the same way. "The list and the export agree"
 * is only true if there is exactly one reading of `?from=…&status=…`.
 *
 * Ranges are BUSINESS DATES (restaurant-local YYYY-MM-DD), inclusive at both
 * ends, because that is what the daily order numbers and the board already
 * key on. A UTC range would split an 11pm order onto tomorrow's page.
 */

export const HISTORY_PAGE_SIZE = 50;

/** Hard ceiling on a range, so one request cannot ask for a decade. */
export const HISTORY_MAX_DAYS = 400;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface HistoryQuery {
  /** Inclusive business date, YYYY-MM-DD. */
  from: string;
  /** Inclusive business date, YYYY-MM-DD. */
  to: string;
  /** Empty = every status. */
  statuses: OrderStatus[];
  /** Empty = every channel. */
  channels: OrderChannel[];
  /** Empty = both printers. The station the ticket is on (orders.print_station). */
  stations: Station[];
  /** Order number, customer name, or phone digits. Partial match. */
  q: string;
}

const csvList = <T extends string>(allowed: readonly T[]) => {
  const known = new Set<string>(allowed);
  return z
    .string()
    .optional()
    .transform((raw) =>
      (raw ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is T => known.has(s)),
    );
};

const QuerySchema = z.object({
  from: z.string().regex(ISO_DATE),
  to: z.string().regex(ISO_DATE),
  status: csvList(ORDER_STATUSES),
  channel: csvList(ORDER_CHANNELS),
  station: csvList(STATIONS),
  q: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});

/** Whole days from `from` to `to`, inclusive. Negative when reversed. */
export function daysInRange(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Parse a history request. Returns null for anything malformed, a reversed
 * range, or one longer than HISTORY_MAX_DAYS: the route answers 400 rather
 * than guessing what was meant.
 */
export function parseHistoryParams(
  params: URLSearchParams,
): { query: HistoryQuery; page: number } | null {
  const parsed = QuerySchema.safeParse(Object.fromEntries(params.entries()));
  if (!parsed.success) return null;
  const { from, to, status, channel, station, q, page } = parsed.data;
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return null;
  const days = daysInRange(from, to);
  if (days < 1 || days > HISTORY_MAX_DAYS) return null;
  return {
    query: { from, to, statuses: status, channels: channel, stations: station, q: (q ?? "").trim() },
    page: page ?? 1,
  };
}

/** The inverse of parseHistoryParams, for the screen's fetches and CSV link. */
export function historySearchParams(query: HistoryQuery, page?: number): URLSearchParams {
  const p = new URLSearchParams({ from: query.from, to: query.to });
  if (query.statuses.length > 0) p.set("status", query.statuses.join(","));
  if (query.channels.length > 0) p.set("channel", query.channels.join(","));
  if (query.stations.length > 0) p.set("station", query.stations.join(","));
  if (query.q) p.set("q", query.q);
  if (page && page > 1) p.set("page", String(page));
  return p;
}

/* ------------------------------------------------------------ presets -- */

export type RangePreset = "today" | "yesterday" | "week" | "month" | "custom";

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A preset's range, anchored on today's BUSINESS date (passed in, because the
 * browser's own clock may be in another zone).
 *
 * "This week" starts on Monday, as the owner's books do (confirmed).
 */
export function presetRange(
  preset: Exclude<RangePreset, "custom">,
  today: string,
): { from: string; to: string } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = shiftDate(today, -1);
      return { from: y, to: y };
    }
    case "week": {
      const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
      const sinceMonday = (dow + 6) % 7;
      return { from: shiftDate(today, -sinceMonday), to: today };
    }
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today };
  }
}

/* ------------------------------------------------------------ summary -- */

/**
 * Totals for a range. CANCELLED orders are excluded from every figure here
 * except `cancelledCount`: a voided order is not a sale.
 */
export interface HistorySummary {
  orderCount: number;
  salesCents: number;
  averageCents: number;
  cancelledCount: number;
  byChannel: Record<OrderChannel, { orderCount: number; salesCents: number }>;
}

export interface HistoryPage {
  orders: Order[];
  /** Rows matching the filters, across every page. */
  total: number;
  page: number;
  pageSize: number;
  summary: HistorySummary;
}

/* ---------------------------------------------------------------- CSV -- */

export const CSV_HEADER = [
  "order_number",
  "business_date",
  "created_at",
  "customer",
  "phone",
  "channel",
  "items",
  "subtotal",
  "tax",
  "total",
  "status",
  // Dine-in (migration 010). Appended, so a spreadsheet built on the first
  // eleven columns keeps working. Empty for takeout.
  "table",
  "guests",
  "addon",
  // Two printers (migration 011). Appended for the same reason.
  "station",
] as const;

/** RFC 4180 quoting, plus a leading-apostrophe guard against formula injection. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Size tiers that are the default and say nothing, as on the ticket. */
const DEFAULT_SIZES = new Set(["individual", "regular", ""]);

/** "2× Kung Pao Chicken 宮保雞丁 (Party Tray; Fried Rice)" joined by " | ". */
export function itemsAsText(order: Order): string {
  return order.items
    .map((line) => {
      const name = line.nameZh ? `${line.nameEn} ${line.nameZh}` : line.nameEn;
      const extras = [
        ...(DEFAULT_SIZES.has(line.sizeLabel.toLowerCase()) ? [] : [line.sizeLabel]),
        ...line.modifiers.map((m) => m.nameEn),
        ...(line.specialInstructions ? [`note: ${line.specialInstructions}`] : []),
      ];
      return `${line.quantity}x ${name}${extras.length > 0 ? ` (${extras.join("; ")})` : ""}`;
    })
    .join(" | ");
}

export function csvRow(order: Order, timezone: string): string {
  const created = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(order.createdAt))
    .replace(",", "");
  return [
    order.orderNumber,
    order.businessDate,
    created,
    order.customer.name,
    order.customer.phone,
    order.channel,
    itemsAsText(order),
    dollars(order.totals.subtotalCents),
    dollars(order.totals.taxCents),
    dollars(order.totals.totalCents),
    order.status,
    order.tableLabel ?? "",
    order.guestCount ?? "",
    order.isAddon ? "yes" : "",
    order.station,
  ]
    .map((v) => csvCell(String(v ?? "")))
    .join(",");
}
