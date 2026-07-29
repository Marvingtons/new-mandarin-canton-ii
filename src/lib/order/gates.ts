import { phonesSentence } from "@/data/restaurant";
import {
  ORDER_CUTOFF_MINUTES,
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
  const lastOrder = clockLabel(window.close - ORDER_CUTOFF_MINUTES);
  const mins = minutesNow(now, opts);

  // Past the cutoff but before close: the doors are open, so "we're closed"
  // would read as a lie to someone standing outside looking at the lights.
  if (mins < window.close && mins >= window.close - ORDER_CUTOFF_MINUTES) {
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
