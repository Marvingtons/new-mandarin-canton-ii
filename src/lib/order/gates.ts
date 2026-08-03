import { phonesSentence } from "@/data/restaurant";
import {
  clockLabel,
  hoursForDay,
  isAcceptingOrders,
  localNow,
  minutesNow,
  type PickupOptions,
} from "@/lib/order/pickup";

/**
 * The order-submission gates, and the messages they refuse with.
 *
 * Every one of these resolves the clock through the RESTAURANT's timezone.
 * The browser's clock never gates anything: a client may hide a control for
 * UX, but the decision that reaches the kitchen is made here.
 *
 * Messages are bilingual and self-sufficient — a customer who hits one should
 * not have to go looking for the hours or a phone number.
 */

/** Why an order was refused, in both languages, as one line. */
export function closedMessage(now: Date, opts: PickupOptions): string {
  const { day } = localNow(opts.timezone, now);
  const window = hoursForDay(day);

  if (!window) {
    return (
      `We're closed today. Please call ${phonesSentence} for help. · ` +
      `今日休息，請致電 ${phonesSentence}。`
    );
  }

  const openLabel = clockLabel(window.open);
  const closeLabel = clockLabel(window.close);
  const lastOrder = clockLabel(window.lastOrder);
  const mins = minutesNow(now, opts);

  // Past the cutoff but before close: the doors are open, so "we're closed"
  // would read as a lie to someone standing outside looking at the lights.
  //
  // ⚠️ CURRENTLY UNREACHABLE ON EVERY DAY, and kept anyway. The owner set
  // `lastOnlineOrder` to the closing time all week, so there is no minute
  // that satisfies both halves of this condition — what used to be true of
  // Sunday alone is now true of the whole week. It stays because it is the
  // correct answer to a state the configuration can re-enter with a single
  // edit: give any day a cutoff before its close and this is what that
  // day's customers must be told. Deleting it would mean the next buffer
  // ships with "we're closed" over a lit dining room, which is the exact
  // bug this branch was written to fix.
  if (mins < window.close && mins >= window.lastOrder) {
    return (
      `Online orders for today closed at ${lastOrder} so the kitchen can finish by ${closeLabel}. ` +
      `Please call ${phonesSentence}. · ` +
      `今日網上落單已於 ${lastOrder} 截止，請致電 ${phonesSentence}。`
    );
  }

  return (
    `We're closed for online orders right now. Today: ${openLabel} – ${closeLabel} ` +
    `(last online order ${lastOrder}). Please call ${phonesSentence}. · ` +
    `現時暫停網上落單。今日營業 ${openLabel} – ${closeLabel}，` +
    `網上落單至 ${lastOrder}。請致電 ${phonesSentence}。`
  );
}

/** True when the submit path should be allowed at all. */
export { isAcceptingOrders };

/* ------------------------------------------------------ lunch specials -- */

/** Lunch service, restaurant-local minutes past midnight: 11:00 AM – 3:00 PM. */
export const LUNCH_START_MINUTES = 11 * 60;
export const LUNCH_END_MINUTES = 15 * 60;

/**
 * Is it lunch right now, in restaurant time?
 *
 * The gate is on PLACEMENT time, not pickup time: an order placed at 2:55 PM
 * is a valid lunch order even though it will be collected after 3:00. That
 * matches how the counter treats it.
 *
 * ⚠️ TODO(confirm): holiday lunch closures — the printed menu says "Except
 * Holiday No Lunch", but there is no holiday calendar in this system and one
 * must not be invented. Owner to specify the dates. No holiday gate is
 * implemented, so lunch specials remain orderable on holidays.
 */
export function isLunchService(now: Date, opts: PickupOptions): boolean {
  const mins = minutesNow(now, opts);
  return mins >= LUNCH_START_MINUTES && mins < LUNCH_END_MINUTES;
}

/** Refusal for a lunch item outside 11–3, in both languages. */
export function lunchClosedMessage(): string {
  const from = clockLabel(LUNCH_START_MINUTES);
  const to = clockLabel(LUNCH_END_MINUTES);
  return (
    `Lunch specials are served ${from} – ${to} only. ` +
    `Please remove them or order them tomorrow at lunch. · ` +
    `午市套餐只供應 ${from} 至 ${to}，請移除或於明日午市訂購。`
  );
}
