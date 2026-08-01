import { restaurant } from "@/data/restaurant";
import type { DayOfWeek } from "@/data/restaurant";

/**
 * Pickup-time computation, resolved in the RESTAURANT's timezone (never the
 * visitor's clock). Pure and shared by the client (renders the slot picker)
 * and the server (re-validates the submitted slot). Because both compute the
 * same set from the same data, a tampered pickup time is rejected server-side.
 *
 * Store hours come from restaurant.ts:
 *   Mon–Fri 11:00–21:00 · Sat 11:00–21:30 · Sun 11:00–20:30
 */

export interface PickupSlot {
  /** "asap" or 24h "HH:MM" in restaurant-local time. */
  value: string;
  label: string;
}

export interface PickupOptions {
  timezone: string;
  /** Prep lead before the earliest ASAP/scheduled slot. */
  leadMinutes: number;
  /** Slot granularity. */
  intervalMinutes: number;
}

const SHORT_TO_DAY: Record<string, DayOfWeek> = {
  Sun: "sunday",
  Mon: "monday",
  Tue: "tuesday",
  Wed: "wednesday",
  Thu: "thursday",
  Fri: "friday",
  Sat: "saturday",
};

/** Restaurant-local day + minutes-past-midnight for an instant. */
export function localNow(
  timezone: string,
  at: Date,
): { day: DayOfWeek; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = SHORT_TO_DAY[get("weekday")] ?? "monday";
  const hour = Number.parseInt(get("hour"), 10) % 24;
  const minute = Number.parseInt(get("minute"), 10);
  return { day, minutes: (hour || 0) * 60 + (minute || 0) };
}

/** "11:00 AM" -> 660 minutes past midnight, or null. */
function parse12h(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t.trim());
  if (!m) return null;
  const h = (Number.parseInt(m[1], 10) % 12) + (/pm/i.test(m[3]) ? 12 : 0);
  return h * 60 + Number.parseInt(m[2], 10);
}

/** 780 -> "1:00 PM" */
function label12h(mins: number): string {
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** 780 -> "13:00" */
function hhmm(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/**
 * Today's window: when the doors are open, and when the website stops
 * taking orders.
 *
 * `lastOrder` USED TO BE `close - ORDER_CUTOFF_MINUTES`, a flat 20 minutes
 * for every day. It is now a per-day clock time read from restaurant.ts,
 * because "how long before close does the kitchen need" is not actually a
 * constant — it is a decision the owner makes per night. Everything that
 * needs the cutoff reads it from HERE, so there is exactly one answer:
 * this function, isAcceptingOrders, both branches of closedMessage, and
 * the copy on the menu banner and in the footer all resolve the same
 * number.
 *
 * Clamped to the door hours. A lastOnlineOrder later than closing would
 * let the site take an order it cannot fill; earlier than opening would
 * close ordering before it started. Sunday is the deliberate equality
 * case — cutoff EQUALS close — and is allowed.
 */
function todaysWindow(
  day: DayOfWeek,
): { open: number; close: number; lastOrder: number } | null {
  const h = restaurant.hours[day];
  if (h.closed) return null;
  const open = parse12h(h.open);
  const close = parse12h(h.close);
  if (open === null || close === null) return null;
  const configured = parse12h(h.lastOnlineOrder);
  const lastOrder =
    configured === null ? close : Math.min(Math.max(configured, open), close);
  return { open, close, lastOrder };
}

/** Today's open/close/last-order in restaurant-local minutes past midnight. */
export function hoursForDay(
  day: DayOfWeek,
): { open: number; close: number; lastOrder: number } | null {
  return todaysWindow(day);
}

/**
 * The last minute an online order may be placed today, or null when the
 * restaurant is closed. The one reader for every surface that quotes it.
 */
export function lastOrderMinutes(
  now: Date,
  opts: PickupOptions,
): number | null {
  const { day } = localNow(opts.timezone, now);
  return todaysWindow(day)?.lastOrder ?? null;
}

/** Is the DINING ROOM open right now? (Ignores the ordering cutoff.) */
export function isOpenNow(now: Date, opts: PickupOptions): boolean {
  const { day, minutes } = localNow(opts.timezone, now);
  const w = todaysWindow(day);
  return w != null && minutes >= w.open && minutes < w.close;
}

/**
 * Is the store accepting ONLINE ORDERS right now?
 *
 * Open, and not yet past today's last-order time. This is the gate the
 * submit path enforces; `isOpenNow` remains the answer to "are the doors
 * open", which is a different question and still the right one for the
 * hours chip. On most days the two now diverge for a stretch — Saturday
 * has a full hour where the doors are open and the website is not — which
 * is exactly why the refusal copy must never say "we're closed".
 */
export function isAcceptingOrders(now: Date, opts: PickupOptions): boolean {
  const { day, minutes } = localNow(opts.timezone, now);
  const w = todaysWindow(day);
  if (!w) return false;
  return minutes >= w.open && minutes < w.lastOrder;
}

/** Today's hours as a 12-hour label, e.g. "11:00 AM – 9:00 PM". Null if closed. */
export function todaysHoursLabel(now: Date, opts: PickupOptions): string | null {
  const { day } = localNow(opts.timezone, now);
  const w = todaysWindow(day);
  if (!w) return null;
  return `${label12h(w.open)} – ${label12h(w.close)}`;
}

/** Restaurant-local minutes past midnight, exported for the order gates. */
export function minutesNow(now: Date, opts: PickupOptions): number {
  return localNow(opts.timezone, now).minutes;
}

/** Clock label for restaurant-local minutes past midnight. */
export function clockLabel(minutes: number): string {
  return label12h(minutes);
}

/**
 * Slots for today: "ASAP" (when open) plus scheduled times from the next
 * interval boundary after now+lead, up to close. Empty when closed.
 */
export interface PickupSlotOptions {
  /**
   * Offer slots as though the restaurant were open, ignoring the clocks.
   *
   * ONLY for a test-mode session, and ONLY presentation. The server does not
   * trust this and never sees it: a submitted value is still validated there,
   * by isWellFormedPickupValue on a bypassed request and by isValidPickup on
   * every other one. Setting it here cannot make the server accept anything
   * it would otherwise refuse.
   *
   * It exists because the bypass was unreachable from the real UI. The server
   * would accept an out-of-hours order, but pickupSlots returned [] when
   * closed, so the selector had nothing to select and Place Order stayed
   * disabled — the one path that could not be tested end to end was the one
   * customers actually use.
   */
  asIfOpen?: boolean;
}

export function pickupSlots(
  now: Date,
  opts: PickupOptions,
  slotOpts: PickupSlotOptions = {},
): PickupSlot[] {
  const asIfOpen = slotOpts.asIfOpen === true;
  const { day, minutes } = localNow(opts.timezone, now);
  const w = todaysWindow(day);

  if (!asIfOpen) {
    if (!w || minutes >= w.close) return [];

    // Past the ordering cutoff nothing is offerable — the submit path would
    // reject it anyway, and showing slots the server will refuse is worse than
    // showing none.
    if (!isAcceptingOrders(now, opts)) return [];
  }

  const slots: PickupSlot[] = [];
  if (asIfOpen || isOpenNow(now, opts)) {
    slots.push({
      value: "asap",
      // TODO(confirm): real ASAP quote with the owner.
      label: `ASAP (~${opts.leadMinutes}–${opts.leadMinutes + 10} min)`,
    });
  }

  if (w) {
    let earliest = Math.max(w.open, minutes + opts.leadMinutes);
    // Testing at 3am, every scheduled time for the day is already behind us.
    // Offer the day's window from the top rather than an ASAP-only list, so
    // the scheduled-time path is exercisable too.
    if (asIfOpen && earliest > w.close) earliest = w.open;
    let t = Math.ceil(earliest / opts.intervalMinutes) * opts.intervalMinutes;
    for (; t <= w.close; t += opts.intervalMinutes) {
      slots.push({ value: hhmm(t), label: label12h(t) });
    }
  }
  // On a day with no window at all, asIfOpen still leaves ASAP — which
  // isWellFormedPickupValue accepts — so the form is never stuck.
  return slots;
}

/** Server-side validation: is `value` a slot we would actually offer now? */
export function isValidPickup(
  value: string,
  now: Date,
  opts: PickupOptions,
): boolean {
  return pickupSlots(now, opts).some((s) => s.value === value);
}

/** Human label for a stored pickup value (for confirmation + metadata). */
export function pickupLabel(value: string, opts: PickupOptions): string {
  if (value === "asap") return `ASAP (~${opts.leadMinutes}–${opts.leadMinutes + 10} min)`;
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return value;
  return label12h(Number.parseInt(m[1], 10) * 60 + Number.parseInt(m[2], 10));
}
