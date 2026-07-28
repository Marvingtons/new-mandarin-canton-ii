import { publicTenant } from "@/config/tenant.server";
import {
  hasKitchenSession,
  isKitchenAuthConfigured,
} from "@/lib/auth/kitchenSession";
import { businessDateFor } from "@/lib/orders/businessDate";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import { isPrintingConfigured } from "@/lib/print/printnode";
import KitchenLogin from "@/components/kitchen/KitchenLogin";
import KitchenBoard from "@/components/kitchen/KitchenBoard";

/**
 * The always-on fallback. Even with no printer configured at all, every paid
 * order lands here within ten seconds — that is the entire point of the
 * screen, and why it is built before the printer rather than after it.
 *
 * Auth is checked HERE, on the server, on every request. The client board
 * never decides whether it may render.
 */
export default async function KitchenPage() {
  if (!isKitchenAuthConfigured()) {
    return (
      <main className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-3 px-6 text-center">
        <h1 className="font-display text-3xl text-gold">Kitchen board</h1>
        <p className="text-ivory/80">
          Set <code className="text-gold">ADMIN_DASH_PASSWORD</code> to enable
          this screen. It stays closed until you do.
        </p>
      </main>
    );
  }

  if (!(await hasKitchenSession())) return <KitchenLogin />;

  const tenant = publicTenant();
  return (
    <KitchenBoard
      timezone={tenant.timezone}
      businessDate={businessDateFor(tenant.timezone)}
      ordersConfigured={isOrdersDbConfigured()}
      printingConfigured={isPrintingConfigured()}
    />
  );
}
