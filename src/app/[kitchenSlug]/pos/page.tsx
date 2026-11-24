import type { Metadata } from "next";
import { cookies } from "next/headers";
import { orderGateBypassSecret, publicTenant } from "@/config/tenant.server";
import { staffCatalogMenu } from "@/lib/menu/catalog";
import { isValidTestModeCookie, TEST_MODE_COOKIE } from "@/lib/order/bypass";
import { KitchenFrame, kitchenGuard, kitchenMetadata } from "@/components/kitchen/KitchenGuard";
import PosScreen from "@/components/kitchen/PosScreen";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import { getOrderById } from "@/lib/orders/repository";
import { isEditable, type Order } from "@/lib/orders/types";

/**
 * /{kitchen}/pos: staff order entry for phone calls and walk-ins.
 *
 * Behind the same guard as the board. The menu handed to the client is the
 * staff view of the catalogue (86'd dishes kept, greyed); prices on screen are
 * for quoting only, and the order route recomputes everything server-side.
 *
 * `?edit=<id>` opens it in 改單 EDIT MODE on that order (docs/edit-order.md):
 * the order is read here, on the server, so the ticket is already filled on
 * the first paint. An order that cannot be edited (cancelled, done more than
 * 30 minutes, gone) opens the POS empty with a notice instead.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ kitchenSlug: string }>;
}): Promise<Metadata> {
  return kitchenMetadata((await params).kitchenSlug);
}

/** 改單's window, judged when the page is requested (the save checks again). */
function editableNow(order: Order): boolean {
  return isEditable(order, Date.now());
}

export default async function KitchenPosPage({
  params,
  searchParams,
}: {
  params: Promise<{ kitchenSlug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const guard = await kitchenGuard((await params).kitchenSlug);
  if (!guard.ok) return guard.node;

  const tenant = publicTenant();

  const editParam = (await searchParams).edit;
  const editId = typeof editParam === "string" ? Number.parseInt(editParam, 10) : NaN;
  let editOrder: Order | null = null;
  let editRefused = false;
  if (Number.isFinite(editId)) {
    const order = isOrdersDbConfigured() ? await getOrderById(tenant.tenantId, editId) : null;
    if (order && editableNow(order)) editOrder = order;
    else editRefused = true;
  }
  // A test-mode session (see /api/test-mode) gets pickup times as if the store
  // were open, matching the order route, which honours the same cookie.
  const testMode =
    orderGateBypassSecret() !== null &&
    isValidTestModeCookie((await cookies()).get(TEST_MODE_COOKIE)?.value);

  return (
    <KitchenFrame lang={guard.lang} basePath={guard.basePath} active="pos">
      <PosScreen
        menu={staffCatalogMenu()}
        taxRateBps={tenant.taxRateBps}
        pickupOptions={{
          timezone: tenant.timezone,
          leadMinutes: tenant.pickupLeadMinutes,
          intervalMinutes: tenant.pickupSlotIntervalMinutes,
        }}
        asIfOpen={testMode}
        editOrder={editOrder}
        editRefused={editRefused}
        // A new mount per order (and per revision), so edit mode never keeps
        // the lines of the ticket that was open before it.
        key={editOrder ? `edit-${editOrder.id}-${editOrder.revision}` : "new"}
      />
    </KitchenFrame>
  );
}
