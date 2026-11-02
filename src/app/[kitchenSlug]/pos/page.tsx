import type { Metadata } from "next";
import { cookies } from "next/headers";
import { orderGateBypassSecret, publicTenant } from "@/config/tenant.server";
import { staffCatalogMenu } from "@/lib/menu/catalog";
import { isValidTestModeCookie, TEST_MODE_COOKIE } from "@/lib/order/bypass";
import { KitchenFrame, kitchenGuard, kitchenMetadata } from "@/components/kitchen/KitchenGuard";
import StaffPos from "@/components/kitchen/StaffPos";

/**
 * /{kitchen}/pos: staff order entry for phone calls and walk-ins.
 *
 * Behind the same guard as the board. The menu handed to the client is the
 * staff view of the catalogue (86'd dishes kept, greyed); prices on screen are
 * for quoting only, and the order route recomputes everything server-side.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ kitchenSlug: string }>;
}): Promise<Metadata> {
  return kitchenMetadata((await params).kitchenSlug);
}

export default async function KitchenPosPage({
  params,
}: {
  params: Promise<{ kitchenSlug: string }>;
}) {
  const guard = await kitchenGuard((await params).kitchenSlug);
  if (!guard.ok) return guard.node;

  const tenant = publicTenant();
  // A test-mode session (see /api/test-mode) gets pickup times as if the store
  // were open, matching the order route, which honours the same cookie.
  const testMode =
    orderGateBypassSecret() !== null &&
    isValidTestModeCookie((await cookies()).get(TEST_MODE_COOKIE)?.value);

  return (
    <KitchenFrame lang={guard.lang} basePath={guard.basePath} active="pos">
      <StaffPos
        menu={staffCatalogMenu()}
        taxRateBps={tenant.taxRateBps}
        pickupOptions={{
          timezone: tenant.timezone,
          leadMinutes: tenant.pickupLeadMinutes,
          intervalMinutes: tenant.pickupSlotIntervalMinutes,
        }}
        asIfOpen={testMode}
      />
    </KitchenFrame>
  );
}
