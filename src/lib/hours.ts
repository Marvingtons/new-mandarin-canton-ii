import { restaurant } from "@/data/restaurant";
import type { DayOfWeek } from "@/data/restaurant";
import { tenantNow } from "@/lib/menu/onlineHours";

/**
 * Dine-in open/closed status.
 *
 * Resolves through `restaurant.timezone`, never the visitor's clock —
 * a guest browsing from New York must not read a Chula Vista kitchen as
 * closed three hours early. `tenantNow` (shared with the online-ordering
 * gate) does the Intl/DST work, so both clocks can never drift apart.
 *
 * Pure and injectable (`at`) so it is testable without mocking Date.
 */

/** Index matches the day order `tenantNow` returns. */
const NEXT_DAY: Record<DayOfWeek, DayOfWeek> = {
  sunday: "monday",
  monday: "tuesday",
  tuesday: "wednesday",
  wednesday: "thursday",
  thursday: "friday",
  friday: "saturday",
  saturday: "sunday",
};

/** "11:00 AM" -> 660 minutes past midnight. null if unparseable. */
function parseClock(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t.trim());
  if (!m) return null;
  const h12 = Number.parseInt(m[1], 10);
  const min = Number.parseInt(m[2], 10);
  if (h12 < 1 || h12 > 12 || min > 59) return null;
  const h = (h12 % 12) + (/pm/i.test(m[3]) ? 12 : 0);
  return h * 60 + min;
}

export interface OpenStatus {
  open: boolean;
  /** Sentence-case label, e.g. "Open · until 9:00 PM". */
  label: string;
}

/**
 * Current dine-in status. Returns null only if the hours data itself is
 * malformed — callers render nothing rather than guess a state.
 */
export function openStatus(at: Date = new Date()): OpenStatus | null {
  const { day, minutes } = tenantNow(restaurant.timezone, at);
  const today = restaurant.hours[day as DayOfWeek];

  if (!today.closed) {
    const open = parseClock(today.open);
    const close = parseClock(today.close);
    if (open === null || close === null) return null;
    if (minutes >= open && minutes < close)
      return { open: true, label: `Open · until ${today.close}` };
    if (minutes < open)
      return { open: false, label: `Closed · opens ${today.open}` };
  }

  // Past today's close (or closed all day): point at the next day that
  // actually opens, so a Monday holiday never advertises Monday's hours.
  let cursor: DayOfWeek = day as DayOfWeek;
  for (let i = 0; i < 7; i++) {
    cursor = NEXT_DAY[cursor];
    const next = restaurant.hours[cursor];
    if (!next.closed && parseClock(next.open) !== null)
      return { open: false, label: `Closed · opens ${next.open}` };
  }
  return null;
}
