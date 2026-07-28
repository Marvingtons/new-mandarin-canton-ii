import "server-only";

import { isSmsConfigured } from "@/config/tenant.server";
import { restaurant } from "@/data/restaurant";
import { sendSms } from "@/lib/otp/twilio";
import type { Order } from "@/lib/orders/types";

/**
 * "Your order is ready" text.
 *
 * Reuses the number the customer already verified, so there is no new consent
 * question and no second number to get wrong.
 *
 * Never throws and never blocks the caller's outcome: the kitchen tapping 完成
 * must succeed whether or not Twilio is reachable. An un-sent courtesy text is
 * a minor annoyance; a 完成 button that appears to fail makes staff tap it
 * twice and distrust the screen.
 */
export async function notifyOrderReady(
  order: Order,
): Promise<{ sent: boolean; error?: string }> {
  if (!isSmsConfigured()) {
    return { sent: false, error: "SMS is not configured" };
  }

  // Tenant name comes from config data, not a literal — see the multi-tenancy
  // rule. Same for the address the customer is being sent to.
  const body =
    `${restaurant.name}: order ${order.orderNumber} is ready for pickup. ` +
    `${restaurant.address.street}. Please pay at the counter.`;

  const result = await sendSms(order.customer.phone, body);
  if (!result.sent) {
    console.warn(
      `[notify] order-ready SMS for ${order.orderNumber} not sent: ${result.error}`,
    );
  }
  return result;
}
