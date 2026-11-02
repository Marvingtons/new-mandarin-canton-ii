import type { Metadata } from "next";
import { publicTenant } from "@/config/tenant.server";
import { businessDateFor } from "@/lib/orders/businessDate";
import { KitchenFrame, kitchenGuard, kitchenMetadata } from "@/components/kitchen/KitchenGuard";
import OrderHistory from "@/components/kitchen/OrderHistory";

/**
 * /{kitchen}/history: every previous order, filterable, exportable.
 *
 * Today's BUSINESS date is computed here, in the restaurant's timezone, and
 * anchors the presets: the tablet's own clock may be in another zone, and
 * "today" must mean the same thing as the daily order numbers.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ kitchenSlug: string }>;
}): Promise<Metadata> {
  return kitchenMetadata((await params).kitchenSlug);
}

export default async function KitchenHistoryPage({
  params,
}: {
  params: Promise<{ kitchenSlug: string }>;
}) {
  const guard = await kitchenGuard((await params).kitchenSlug);
  if (!guard.ok) return guard.node;

  const tenant = publicTenant();
  return (
    <KitchenFrame lang={guard.lang} basePath={guard.basePath} active="history">
      <OrderHistory timezone={tenant.timezone} today={businessDateFor(tenant.timezone)} />
    </KitchenFrame>
  );
}
