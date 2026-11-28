import { pickupInstant } from "@/lib/orders/businessDate";
import { staffPickupAcceptable, type PickupOptions } from "@/lib/order/pickup";
import { readyWindow } from "@/lib/order/readyWindow";

/**
 * When a staff order (phone, walk-in) is due, decided once by the staff route.
 *
 * NO TIME WINDOW. Unlike the web, nothing here reads store hours, the online
 * cutoff or the minimum lead: staff may take an order at any time of day,
 * after closing, or on a closed day. The only refusal is a time that does not
 * parse or that is already more than five minutes past.
 *
 *   - "asap": pickupAt = now + lead, the ready window = now + the prep range.
 *   - "HH:MM" today: pickupAt and readyFrom = that time, as staff told the caller.
 *
 * Pure and clock-injected, so verify:staff-orders can pin it at 8:41 PM on a
 * Friday without touching the system clock.
 */
export type StaffPickupPlan =
  | { ok: false }
  | { ok: true; asap: boolean; pickupAt: Date; readyFrom: Date; readyTo: Date; scheduledFor: Date | null };

export function staffPickupPlan(
  value: string,
  now: Date,
  opts: PickupOptions,
  longPrep: boolean,
): StaffPickupPlan {
  const asap = value === "asap";
  const at = pickupInstant(value, opts.timezone, opts.leadMinutes, now);
  if (!staffPickupAcceptable(value, at, now)) return { ok: false };
  const ready = readyWindow(now, opts, longPrep, asap ? null : at, false);
  return {
    ok: true,
    asap,
    pickupAt: asap ? at : ready.from,
    readyFrom: ready.from,
    readyTo: ready.to,
    scheduledFor: asap ? null : at,
  };
}
