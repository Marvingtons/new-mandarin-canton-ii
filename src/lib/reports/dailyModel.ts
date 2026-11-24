/**
 * 日結 DAILY REPORT: the numbers, and the one definition of how they are
 * counted.
 *
 * WHAT THIS IS. An ORDERS report for one business day, printed on the 80mm
 * ticket printer and laid next to the card terminal's batch report and the
 * cash drawer. This system never takes payment (online orders pay at pickup,
 * the POS prints tickets), so nothing here is a tender, a tip or a card total.
 * See docs/daily-report.md.
 *
 * PURE: no database, no `server-only`, no clock. Two readers:
 *   - `summarizeDay` is the REFERENCE MODEL. The fixtures and report:sample
 *     build reports through it, and Phase 2's verify:daily-report asserts that
 *     the single SQL aggregate in lib/reports/daily.ts returns the same
 *     DailyReport for the same rows, number for number.
 *   - the ticket renderer (lib/ticket/report.ts) and the preview read the
 *     DailyReport shape and nothing else.
 *
 * Money is INTEGER CENTS, as everywhere in this app.
 */

import { CHANNEL_STATION, type Station } from "@/config/stations";
import { comboCategories } from "@/data/combo-items";
import { CUSTOM_ITEM_ID, SURCHARGE_MODIFIER_ID } from "@/lib/kitchen/customCharge";
import { TRAY_SIZE_IDS } from "@/lib/menu/types";
import type { OrderChannel, OrderLine, OrderStatus, OrderTotals } from "@/lib/orders/types";

/* ------------------------------------------------------------ definitions -- */

/**
 * WHAT COUNTS. An order counts once it reached the kitchen: the printer
 * confirmed it (PRINTED), the kitchen took it (ACCEPTED), or it was handed over
 * (COMPLETED). There is no "refused" status in this system (OrderStatus);
 * CANCELLED is the only way an order is taken back.
 */
export const SOLD_STATUSES: readonly OrderStatus[] = ["PRINTED", "ACCEPTED", "COMPLETED"];

/**
 * NOT YET ON PAPER at print time: QUEUED (waiting for the printer) and
 * PRINT_FAILED (gave up; waiting for a 重印). Listed under 未計入 NOT INCLUDED
 * so the owner knows the kitchen may still be cooking something the totals do
 * not show.
 */
export const UNPRINTED_STATUSES: readonly OrderStatus[] = ["QUEUED", "PRINT_FAILED"];

export const CANCELLED_STATUSES: readonly OrderStatus[] = ["CANCELLED"];

/**
 * The ORDERS block's rows, in print order. dine_in is retired (2026-11-14) and
 * gets a row only on a day that has one; it is a Store channel
 * (config/stations.ts) and folds into Store and All like phone and walk-in.
 */
export const REPORT_CHANNELS: readonly OrderChannel[] = ["web", "phone", "walk_in", "dine_in"];

/** The TOTALS block's columns. Online + Store = All on every row, always. */
export const REPORT_COLUMNS = ["online", "store", "all"] as const;
export type ReportColumn = (typeof REPORT_COLUMNS)[number];

/** Optional blocks. The three top blocks (ORDERS, TOTALS, NOT INCLUDED) always print. */
export interface ReportBlocks {
  trays: boolean;
  top: boolean;
  hours: boolean;
}
export const DEFAULT_BLOCKS: ReportBlocks = { trays: true, top: true, hours: true };

/** How many dishes 熱賣 TOP lists. */
export const TOP_ITEMS = 10;

/* ------------------------------------------------------------------ shape -- */

/** Count and money for one row. Every amount is stored, never recomputed. */
export interface Bucket {
  /** Orders. Add-on tickets (is_addon) are NOT orders and never add to this. */
  count: number;
  /** Stored subtotal MINUS the charges below, so Subtotal + Charges is the stored subtotal. */
  subtotalCents: number;
  /** 加價: custom lines plus dish surcharges, lifted out of the subtotal. */
  chargesCents: number;
  taxCents: number;
  /** Dormant (always 0 today). Printed only if a day ever has one, so the column still adds up. */
  tipCents: number;
  totalCents: number;
}

export interface TopItem {
  itemId: string;
  nameEn: string;
  nameZh: string | null;
  quantity: number;
  /** Line totals for this item, sizes merged, surcharges excluded (they are Charges). */
  salesCents: number;
}

export interface HourRow {
  /** Restaurant-local hour, 0-23. */
  hour: number;
  count: number;
  totalCents: number;
}

/** Everything the printed report shows. Rendering reads this and nothing else. */
export interface DailyReport {
  tenantId: string;
  /** Restaurant-local YYYY-MM-DD: orders.business_date. */
  businessDate: string;
  timezone: string;
  /** First and last order created that day, any status. Null on an empty day. */
  firstOrderAt: string | null;
  lastOrderAt: string | null;

  /** ORDERS 訂單: counted orders per channel. dine_in is zero on every day since 2026-11-14. */
  channels: Record<OrderChannel, Bucket>;
  /** TOTALS 金額: the same money by station, and the sum. */
  columns: Record<ReportColumn, Bucket>;
  /** NOT INCLUDED 未計入. Totals are the stored would-be totals. */
  cancelled: Bucket;
  unprinted: Bucket;

  /** TRAYS 餐盤: quantities, not lines, on counted orders. */
  trays: { halfTray: number; partyTray: number; familyDinners: number };
  /** TOP 10 熱賣, by quantity then sales. Custom lines excluded. */
  top: TopItem[];
  /** BY HOUR 時段: hours with at least one counted order, in order. */
  hours: HourRow[];

  /** Short, stable fingerprint of every number above. Same numbers, same code. */
  code: string;
}

/** Print metadata: who printed it, where, and which print of the day it is. */
export interface ReportPrint {
  printedAt: string;
  station: Station;
  /** 1-based, per (tenant, business date). */
  sequence: number;
  blocks: ReportBlocks;
}

/* ------------------------------------------------------------ the inputs -- */

/**
 * The subset of an order row the report reads. `isAddon` is orders.is_addon,
 * which the Order type does not carry (no reader needed it until now).
 */
export interface ReportOrderRow {
  channel: OrderChannel;
  status: OrderStatus;
  isAddon?: boolean;
  items: OrderLine[];
  totals: OrderTotals;
  createdAt: string;
}

/* ---------------------------------------------------------------- helpers -- */

export function emptyBucket(): Bucket {
  return { count: 0, subtotalCents: 0, chargesCents: 0, taxCents: 0, tipCents: 0, totalCents: 0 };
}

function addInto(into: Bucket, from: Bucket): void {
  into.count += from.count;
  into.subtotalCents += from.subtotalCents;
  into.chargesCents += from.chargesCents;
  into.taxCents += from.taxCents;
  into.tipCents += from.tipCents;
  into.totalCents += from.totalCents;
}

const cents = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/**
 * 加價 on one line: the whole line when it is a custom charge, otherwise each
 * surcharge modifier times the quantity. A surcharge is already inside the
 * line's unitCents (customCharge.ts), so this is the share of the stored
 * subtotal that came from typed money rather than the menu.
 */
export function lineChargeCents(line: OrderLine): number {
  if (line.custom === true || line.itemId === CUSTOM_ITEM_ID) return cents(line.lineCents);
  const qty = Math.max(1, Math.floor(cents(line.quantity)));
  return (line.modifiers ?? [])
    .filter((m) => m.id === SURCHARGE_MODIFIER_ID)
    .reduce((n, m) => n + cents(m.priceCents) * qty, 0);
}

/** One order as a bucket. Tax and total are the stored values, never recomputed. */
export function orderBucket(row: ReportOrderRow): Bucket {
  const charges = row.items.reduce((n, l) => n + lineChargeCents(l), 0);
  return {
    count: row.isAddon ? 0 : 1,
    subtotalCents: cents(row.totals.subtotalCents) - charges,
    chargesCents: charges,
    taxCents: cents(row.totals.taxCents),
    tipCents: cents(row.totals.tipCents),
    totalCents: cents(row.totals.totalCents),
  };
}

/** Restaurant-local hour of an instant. */
export function localHour(iso: string, timezone: string): number {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hourCycle: "h23",
  }).format(new Date(iso));
  return Number.parseInt(h, 10) % 24;
}

/**
 * The 8-character code in the footer: FNV-1a over every number on the report,
 * written in Crockford base32 (no I, L, O, U). Two prints with the same code
 * printed the same numbers; a later print with a different code is the one to
 * trust. Sync and dependency-free so the preview computes it too.
 */
export function reportCode(report: Omit<DailyReport, "code">): string {
  const canonical = JSON.stringify([
    report.tenantId,
    report.businessDate,
    REPORT_CHANNELS.map((c) => report.channels[c]),
    REPORT_COLUMNS.map((c) => report.columns[c]),
    report.cancelled,
    report.unprinted,
    report.trays,
    report.top.map((t) => [t.itemId, t.quantity, t.salesCents]),
    report.hours,
  ]);
  // Two 32-bit FNV-1a passes (different offset bases), 40 bits kept: all 32
  // of the first and the low 8 of the second. Plain numbers, no BigInt, so it
  // compiles at this project's ES2017 target.
  const fnv = (basis: number): number => {
    let h = basis >>> 0;
    for (let i = 0; i < canonical.length; i++) {
      h ^= canonical.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  };
  const a = fnv(0x811c9dc5);
  const b = fnv(0x050c5d1f) & 0xff;
  // 40 bits as 8 groups of 5: the high 32 bits from `a`, the low 8 from `b`.
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "";
  let lo = b; // bits 0..7
  let hi = a; // bits 8..39
  for (let i = 0; i < 8; i++) {
    const digit = lo & 31;
    out = alphabet[digit] + out;
    // shift the 40-bit (hi:lo) right by 5
    lo = ((lo >>> 5) | ((hi & 31) << 3)) & 0xff;
    hi = hi >>> 5;
  }
  return out;
}

/**
 * 家庭餐 FAMILY DINNERS: every item in the family-dinner and big-family-dinner
 * combo categories. Order lines do not store a category, so the report matches
 * on item id; the set is read from the same combo builder the POS and the
 * ticket font read, so a new set is counted the day it is added. Phase 2
 * passes this list to the SQL aggregate as a parameter.
 */
export const FAMILY_CATEGORY_IDS: readonly string[] = ["family-dinners", "big-family-dinner"];

export function familyDinnerItemIds(): Set<string> {
  return new Set(
    comboCategories()
      .filter((c) => FAMILY_CATEGORY_IDS.includes(c.id))
      .flatMap((c) => c.items.map((i) => i.id)),
  );
}

/* ------------------------------------------------------ reference model -- */

export interface SummarizeOptions {
  tenantId: string;
  businessDate: string;
  timezone: string;
  /** Item ids that count as 家庭餐 Family dinners. See familyDinnerItemIds. */
  familyItemIds: ReadonlySet<string>;
}

/**
 * The reference aggregation over one business day's rows.
 *
 * The caller passes exactly the rows whose orders.business_date is the day;
 * this function does not decide the day. Add-on rows fold into their own
 * channel (a 加菜 round is always dine_in, a Store channel) and into every
 * money figure, but are never an order in any count.
 */
export function summarizeDay(rows: readonly ReportOrderRow[], opts: SummarizeOptions): DailyReport {
  const channels = Object.fromEntries(
    REPORT_CHANNELS.map((c) => [c, emptyBucket()]),
  ) as Record<OrderChannel, Bucket>;
  const columns = Object.fromEntries(
    REPORT_COLUMNS.map((c) => [c, emptyBucket()]),
  ) as Record<ReportColumn, Bucket>;
  const cancelled = emptyBucket();
  const unprinted = emptyBucket();
  const trays = { halfTray: 0, partyTray: 0, familyDinners: 0 };
  const items = new Map<string, TopItem>();
  const hours = new Map<number, HourRow>();

  let first: string | null = null;
  let last: string | null = null;

  for (const row of rows) {
    const t = Date.parse(row.createdAt);
    if (first === null || t < Date.parse(first)) first = row.createdAt;
    if (last === null || t > Date.parse(last)) last = row.createdAt;

    const bucket = orderBucket(row);
    if (CANCELLED_STATUSES.includes(row.status)) {
      addInto(cancelled, bucket);
      continue;
    }
    if (UNPRINTED_STATUSES.includes(row.status)) {
      addInto(unprinted, bucket);
      continue;
    }
    if (!SOLD_STATUSES.includes(row.status)) continue;

    addInto(channels[row.channel], bucket);
    addInto(columns[CHANNEL_STATION[row.channel]], bucket);
    addInto(columns.all, bucket);

    const hour = localHour(row.createdAt, opts.timezone);
    const h = hours.get(hour) ?? { hour, count: 0, totalCents: 0 };
    h.count += bucket.count;
    h.totalCents += bucket.totalCents;
    hours.set(hour, h);

    for (const line of row.items) {
      const qty = Math.max(1, Math.floor(cents(line.quantity)));
      // TRAY_SIZE_IDS is the tray family; the half tray is its one smaller
      // capacity, and any capacity added later counts as a party tray until
      // the report grows a row for it.
      if (TRAY_SIZE_IDS.has(line.sizeId)) {
        if (line.sizeId === "half-tray") trays.halfTray += qty;
        else trays.partyTray += qty;
      }
      if (opts.familyItemIds.has(line.itemId)) trays.familyDinners += qty;

      if (line.custom === true || line.itemId === CUSTOM_ITEM_ID) continue;
      const entry = items.get(line.itemId) ?? {
        itemId: line.itemId,
        nameEn: line.nameEn,
        nameZh: line.nameZh,
        quantity: 0,
        salesCents: 0,
      };
      entry.quantity += qty;
      entry.salesCents += cents(line.lineCents) - lineChargeCents(line);
      items.set(line.itemId, entry);
    }
  }

  const top = [...items.values()]
    .sort(
      (a, b) =>
        b.quantity - a.quantity ||
        b.salesCents - a.salesCents ||
        // Code-point order, not localeCompare: the SQL aggregate sorts the
        // same tie with `collate "C"`, and the two must agree on every host.
        (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0),
    )
    .slice(0, TOP_ITEMS);

  const report: Omit<DailyReport, "code"> = {
    tenantId: opts.tenantId,
    businessDate: opts.businessDate,
    timezone: opts.timezone,
    firstOrderAt: first,
    lastOrderAt: last,
    channels,
    columns,
    cancelled,
    unprinted,
    trays,
    top,
    hours: [...hours.values()].sort((a, b) => a.hour - b.hour),
  };
  return { ...report, code: reportCode(report) };
}

/* ------------------------------------------------------------- formatting -- */

/** "$2,104.50". Thousands grouped, cents always shown. */
export function formatMoney(cents: number, dollarSign = true): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${dollarSign ? "$" : ""}${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** "9:02p", "11:00a": the receipt-tape clock. */
export function formatClock(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")}${get("dayPeriod").toLowerCase().startsWith("p") ? "p" : "a"}`;
}

/** "11a", "12p", "1p": an hour bucket's label. */
export function formatHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${hour < 12 ? "a" : "p"}`;
}

/** "Sun 22 Nov 2026" for a YYYY-MM-DD business date. */
export function formatBusinessDate(date: string): string {
  const [y, m, d] = date.split("-").map((n) => Number.parseInt(n, 10));
  const at = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(at);
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(at);
  return `${weekday} ${d} ${month} ${y}`;
}

/* ------------------------------------------------------------ the day -- */

/**
 * Before this local hour, the print sheet opens on YESTERDAY. The restaurant
 * closes at 9pm; someone printing the day's report at 12:30am means the day
 * that just ended, not the one that has not started. This only picks the
 * sheet's starting date: which day an ORDER belongs to is orders.business_date,
 * written once at insert (lib/orders/businessDate.ts), and never re-derived.
 */
export const REPORT_DAY_ROLLOVER_HOUR = 4;

/** YYYY-MM-DD plus or minus whole days, calendar arithmetic only. */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map((n) => Number.parseInt(n, 10));
  const at = new Date(Date.UTC(y, m - 1, d + days, 12));
  return at.toISOString().slice(0, 10);
}

/** The restaurant-local calendar date and hour of an instant. */
function localDateAndHour(timezone: string, at: Date): { date: string; hour: number } {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return { date, hour: localHour(at.toISOString(), timezone) };
}

/** The latest day a report may be asked for: today, local. Nothing in the future. */
export function todayFor(timezone: string, at: Date = new Date()): string {
  return localDateAndHour(timezone, at).date;
}

/** The day the print sheet opens on: today, or yesterday before 4am. */
export function defaultReportDate(timezone: string, at: Date = new Date()): string {
  const { date, hour } = localDateAndHour(timezone, at);
  return hour < REPORT_DAY_ROLLOVER_HOUR ? shiftDate(date, -1) : date;
}

/** A well-formed YYYY-MM-DD that is a real calendar date. */
export function isReportDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return shiftDate(value, 0) === value;
}

/* ------------------------------------------------------------- invariants -- */

/**
 * Problems with a report, as sentences; empty when it is coherent. Run by
 * report:sample on every fixture and, in Phase 2, by verify:daily-report on the
 * SQL result. A report that fails these must not print.
 */
export function reportProblems(r: DailyReport): string[] {
  const problems: string[] = [];
  const keys: (keyof Bucket)[] = ["count", "subtotalCents", "chargesCents", "taxCents", "tipCents", "totalCents"];

  for (const k of keys) {
    const sum = r.columns.online[k] + r.columns.store[k];
    if (sum !== r.columns.all[k]) problems.push(`Online + Store != All on ${k}: ${sum} vs ${r.columns.all[k]}`);
    const byChannel = REPORT_CHANNELS.reduce((n, c) => n + r.channels[c][k], 0);
    if (byChannel !== r.columns.all[k]) problems.push(`channels do not sum to All on ${k}: ${byChannel} vs ${r.columns.all[k]}`);
  }
  for (const col of REPORT_COLUMNS) {
    const b = r.columns[col];
    const parts = b.subtotalCents + b.chargesCents + b.taxCents + b.tipCents;
    if (parts !== b.totalCents) {
      problems.push(`${col}: subtotal + charges + tax + tip = ${parts}, stored total ${b.totalCents}`);
    }
  }
  const hourCount = r.hours.reduce((n, h) => n + h.count, 0);
  const hourTotal = r.hours.reduce((n, h) => n + h.totalCents, 0);
  if (hourCount !== r.columns.all.count) problems.push(`hours count ${hourCount} != All ${r.columns.all.count}`);
  if (hourTotal !== r.columns.all.totalCents) problems.push(`hours total ${hourTotal} != All ${r.columns.all.totalCents}`);
  return problems;
}
