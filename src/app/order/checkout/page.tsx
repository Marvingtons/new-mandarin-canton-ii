import type { Metadata } from "next";
import { publicTenant } from "@/config/tenant.server";
import Checkout from "@/components/order/Checkout";

export const metadata: Metadata = {
  title: "Checkout · Pickup",
};

/**
 * Pickup checkout. No payment is taken — the server resolves only the tenant's
 * pickup rules and hands them to the client form. The phone verification that
 * replaces payment is done entirely through /api/otp/*, so no credential of
 * any kind reaches this page.
 */
export default function CheckoutPage() {
  const tenant = publicTenant();
  return (
    <Checkout
      timezone={tenant.timezone}
      leadMinutes={tenant.pickupLeadMinutes}
      intervalMinutes={tenant.pickupSlotIntervalMinutes}
      taxRateBps={tenant.taxRateBps}
    />
  );
}
