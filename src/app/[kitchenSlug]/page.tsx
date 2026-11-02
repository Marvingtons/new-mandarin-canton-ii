import type { Metadata } from "next";
import { publicTenant } from "@/config/tenant.server";
import { businessDateFor } from "@/lib/orders/businessDate";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import { cloudPrntConfigured } from "@/lib/print/status";
import { KitchenFrame, kitchenGuard, kitchenMetadata } from "@/components/kitchen/KitchenGuard";
import KitchenBoard from "@/components/kitchen/KitchenBoard";

/**
 * The always-on fallback. Even with no printer configured at all, every paid
 * order lands here within ten seconds — that is the entire point of the
 * screen, and why it is built before the printer rather than after it.
 *
 * THE PATH IS CONFIGURED, NOT COMPILED. This is a dynamic segment that checks
 * the incoming slug against KITCHEN_ROUTE_SLUG server-side — the same shape
 * the CloudPRNT route uses for its path secret — so moving the board is a
 * variable and a deploy. Unset means `/kitchen`, byte for byte what it was.
 * The new-order screen and the history live beneath it (`/{slug}/pos`,
 * `/{slug}/history`) behind the same guard.
 *
 * ⚠️ The slug is obscurity. Auth is checked on the server, on every request,
 * by kitchenGuard, and it is what actually protects this screen; see
 * lib/kitchenRoute for why the password can never be traded away for a
 * secret URL.
 */
export const dynamic = "force-dynamic";

/**
 * ⚠️ METADATA IS CONDITIONAL, AND THERE IS NO layout.tsx, FOR THE SAME REASON:
 * a layout wraps the not-found boundary too, so every unknown top-level path
 * would answer titled "Kitchen". See kitchenMetadata.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ kitchenSlug: string }>;
}): Promise<Metadata> {
  return kitchenMetadata((await params).kitchenSlug);
}

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
      <KitchenBoard
        timezone={tenant.timezone}
        businessDate={businessDateFor(tenant.timezone)}
        ordersConfigured={isOrdersDbConfigured()}
        printingConfigured={cloudPrntConfigured()}
      />
    </KitchenFrame>
  );
}
