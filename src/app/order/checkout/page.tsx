import type { Metadata } from "next";
import { cookies } from "next/headers";
import { publicTenant } from "@/config/tenant.server";
import Checkout from "@/components/order/Checkout";
import { TEST_MODE_COOKIE, isValidTestModeCookie } from "@/lib/order/bypass";

export const metadata: Metadata = {
  title: "Checkout · Pickup",
};

/**
 * Pickup checkout. No payment is taken — the server resolves only the tenant's
 * pickup rules and hands them to the client form. The phone verification that
 * replaces payment is done entirely through /api/otp/*, so no credential of
 * any kind reaches this page.
 */
export default async function CheckoutPage() {
  const tenant = publicTenant();
  // Same source the badge reads: the httpOnly test-mode cookie, validated
  // server-side. Handed down as a plain boolean — the key is not in the
  // cookie, and neither the cookie nor the key crosses to the client.
  const store = await cookies();
  const testMode = isValidTestModeCookie(store.get(TEST_MODE_COOKIE)?.value);
  return (
    <Checkout
      timezone={tenant.timezone}
      leadMinutes={tenant.pickupLeadMinutes}
      intervalMinutes={tenant.pickupSlotIntervalMinutes}
      taxRateBps={tenant.taxRateBps}
      testMode={testMode}
    />
  );
}
