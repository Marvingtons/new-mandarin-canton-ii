import type { Metadata } from "next";
import {
  cloverMerchantId,
  cloverPublicToken,
  cloverSdkUrl,
  publicTenant,
} from "@/config/tenant.server";
import Checkout from "@/components/order/Checkout";

export const metadata: Metadata = {
  title: "Checkout · Pickup",
};

/**
 * Pickup checkout. Server resolves the Clover iframe config (SDK URL, public
 * token, merchant id — none secret) and the tenant pickup rules, then hands
 * them to the client Checkout. The private token stays on the server.
 */
export default function CheckoutPage() {
  const tenant = publicTenant();
  return (
    <Checkout
      sdkUrl={cloverSdkUrl()}
      publicToken={cloverPublicToken()}
      merchantId={cloverMerchantId()}
      timezone={tenant.timezone}
      leadMinutes={tenant.pickupLeadMinutes}
      intervalMinutes={tenant.pickupSlotIntervalMinutes}
      taxRateBps={tenant.taxRateBps}
    />
  );
}
