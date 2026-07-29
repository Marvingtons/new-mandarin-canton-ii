import { clockLabel, hoursForDay, localNow, type PickupOptions } from "@/lib/order/pickup";

/**
 * The "ready around 6:45–6:50 PM" window.
 *
 * Computed ONCE, server-side, at order creation, and stored on the order. The
 * confirmation screen, the kitchen board, the ticket, and the order-ready text
 * all read the stored values — nobody recomputes at render time, because a
 * window that drifts every time it is displayed is worse than no window at
 * all. A customer who re-reads their confirmation an hour later must see the
 * same time the kitchen sees.
 *
 * Displayed as CLOCK TIME rather than "in 17 minutes" for the same reason:
 * a relative phrase is a lie the moment the page is left open.
 */

/** Standard prep, in minutes from order placement. */
export const STANDARD_READY = { min: 15, max: 20 } as const;

/**
 * Party trays, family dinners, and big family dinners. Bigger cook, bigger
 * pack — the kitchen needs the extra time and the customer should be told
 * before they commit, not after.
 */
export const LONG_PREP_READY = { min: 20, max: 30 } as const;

export interface ReadyWindow {
  from: Date;
  to: Date;
  /** True when the long-prep range was used. */
  longPrep: boolean;
}

function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * 60_000);
}

/**
 * Compute the window.
 *
 * `scheduledFor` is the customer's chosen slot when they picked one; ASAP
 * orders pass null and get now + the prep range.
 *
 * The window is CAPPED at closing time. The 20-minute ordering cutoff
 * (lib/order/pickup.ts) makes this rare by design, but a long-prep order
 * placed just inside the cutoff could otherwise promise a pickup after the
 * doors are locked — and a promise the restaurant cannot keep is worse than a
 * tight one.
 */
export function readyWindow(
  now: Date,
  opts: PickupOptions,
  longPrep: boolean,
  scheduledFor: Date | null,
): ReadyWindow {
  const range = longPrep ? LONG_PREP_READY : STANDARD_READY;

  let from: Date;
  let to: Date;
  if (scheduledFor) {
    // The customer named a time. Honour it as the start and show the spread.
    from = scheduledFor;
    to = addMinutes(scheduledFor, range.max - range.min);
  } else {
    from = addMinutes(now, range.min);
    to = addMinutes(now, range.max);
  }

  const closing = closingInstant(now, opts);
  if (closing) {
    if (from.getTime() > closing.getTime()) from = closing;
    if (to.getTime() > closing.getTime()) to = closing;
  }
  // A cap can collapse the range; never render a backwards window.
  if (to.getTime() < from.getTime()) to = from;

  return { from, to, longPrep };
}

/** Today's closing time as an instant, or null when closed. */
function closingInstant(now: Date, opts: PickupOptions): Date | null {
  const { day, minutes } = localNow(opts.timezone, now);
  const window = hoursForDay(day);
  if (!window) return null;
  return new Date(now.getTime() + (window.close - minutes) * 60_000);
}

/**
 * The one function every surface should call to say when an order is due.
 *
 * Reads the STORED window. Falls back to `pickupAt` for orders placed before
 * migration 003 — those have no window, and inventing one from the current
 * clock would be worse than showing the single time that was actually agreed.
 */
export function orderReadyLabel(
  order: { readyFrom: string | null; readyTo: string | null; pickupAt: string },
  timezone: string,
): string {
  if (order.readyFrom && order.readyTo) {
    return formatReadyWindow(
      new Date(order.readyFrom),
      new Date(order.readyTo),
      timezone,
    );
  }
  const at = new Date(order.pickupAt);
  return formatReadyWindow(at, at, timezone);
}

/**
 * "6:45–6:50 PM" — one period when both ends share it, so the common case
 * reads as a range rather than as two separate times.
 */
export function formatReadyWindow(
  from: Date,
  to: Date,
  timezone: string,
): string {
  const mins = (d: Date) => {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (t: string) => Number.parseInt(p.find((x) => x.type === t)?.value ?? "0", 10);
    return (get("hour") % 24) * 60 + get("minute");
  };

  const a = mins(from);
  const b = mins(to);
  if (a === b) return clockLabel(a);

  const sameHalf = (a < 720) === (b < 720);
  if (sameHalf) {
    // "6:45–6:50 PM": drop the first AM/PM, it is redundant.
    const start = clockLabel(a).replace(/\s?(AM|PM)$/i, "");
    return `${start}–${clockLabel(b)}`;
  }
  return `${clockLabel(a)}–${clockLabel(b)}`;
}
