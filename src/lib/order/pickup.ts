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

function todaysWindow(day: DayOfWeek): { open: number; close: number } | null {
  const h = restaurant.hours[day];
  if (h.closed) return null;
  const open = parse12h(h.open);
  const close = parse12h(h.close);
  if (open === null || close === null) return null;
  return { open, close };
}

/** Is the store open for pickup right now? */
export function isOpenNow(now: Date, opts: PickupOptions): boolean {
  const { day, minutes } = localNow(opts.timezone, now);
  const w = todaysWindow(day);
  return w != null && minutes >= w.open && minutes < w.close;
}

/**
 * Slots for today: "ASAP" (when open) plus scheduled times from the next
 * interval boundary after now+lead, up to close. Empty when closed.
 */
export function pickupSlots(now: Date, opts: PickupOptions): PickupSlot[] {
  const { day, minutes } = localNow(opts.timezone, now);
  const w = todaysWindow(day);
  if (!w || minutes >= w.close) return [];

  const slots: PickupSlot[] = [];
  const open = isOpenNow(now, opts);
  if (open) {
    slots.push({
      value: "asap",
      // TODO(confirm): real ASAP quote with the owner.
      label: `ASAP (~${opts.leadMinutes}–${opts.leadMinutes + 10} min)`,
    });
  }

  const earliest = Math.max(w.open, minutes + opts.leadMinutes);
  let t = Math.ceil(earliest / opts.intervalMinutes) * opts.intervalMinutes;
  for (; t <= w.close; t += opts.intervalMinutes) {
    slots.push({ value: hhmm(t), label: label12h(t) });
  }
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
