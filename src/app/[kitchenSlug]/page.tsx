import { Suspense } from "react";
import type { Metadata } from "next";
import { publicTenant } from "@/config/tenant.server";
import { businessDateFor } from "@/lib/orders/businessDate";
import { KitchenFrame, kitchenGuard, kitchenMetadata } from "@/components/kitchen/KitchenGuard";
import OrdersBoard from "@/components/kitchen/OrdersBoard";
import { OrderCardSkeleton } from "@/components/kitchen/ui/Skeleton";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ kitchenSlug: string }>;
}): Promise<Metadata> {
  return kitchenMetadata((await params).kitchenSlug);
}

/** The orders board: every order today, both stations. */
export default async function KitchenPage({
  params,
}: {
  params: Promise<{ kitchenSlug: string }>;
}) {
  const guard = await kitchenGuard((await params).kitchenSlug);
  if (!guard.ok) return guard.node;

  const tenant = publicTenant();
  return (
    <KitchenFrame lang={guard.lang} basePath={guard.basePath} active="board">
      {/* The filters read the URL; the fallback is the board's own shape. */}
      <Suspense
        fallback={
          <div className="mx-auto grid w-full max-w-[1600px] gap-4 px-4 pt-24 sm:px-6 lg:grid-cols-2 2xl:grid-cols-3">
            <OrderCardSkeleton />
            <OrderCardSkeleton />
          </div>
        }
      >
        <OrdersBoard
          timezone={tenant.timezone}
          businessDate={businessDateFor(tenant.timezone)}
          basePath={guard.basePath}
        />
      </Suspense>
    </KitchenFrame>
  );
}
