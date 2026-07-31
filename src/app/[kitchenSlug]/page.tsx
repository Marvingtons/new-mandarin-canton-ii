import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicTenant } from "@/config/tenant.server";
import {
  hasKitchenSession,
  isKitchenAuthConfigured,
} from "@/lib/auth/kitchenSession";
import { businessDateFor } from "@/lib/orders/businessDate";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import { isKitchenSlug } from "@/lib/kitchenRoute";
import { cloudPrntConfigured } from "@/lib/print/status";
import KitchenLogin from "@/components/kitchen/KitchenLogin";
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
 *
 * A non-matching slug calls notFound(), which renders the application's
 * ordinary 404. Not a redirect, not a different message, no hint that a
 * kitchen page exists at some other address: an unknown path and a wrong slug
 * are indistinguishable from outside.
 *
 * ⚠️ The slug is obscurity. Auth is checked HERE, on the server, on every
 * request, and it is what actually protects this screen — see lib/kitchenRoute
 * for why the password can never be traded away for a secret URL.
 */
export const dynamic = "force-dynamic";

/**
 * ⚠️ METADATA IS CONDITIONAL, AND THERE IS NO layout.tsx, FOR THE SAME REASON.
 *
 * This used to be a `metadata` export on a segment layout. A layout wraps the
 * not-found boundary too, so once the board moved behind a dynamic segment
 * EVERY unknown top-level path started answering with `<title>Kitchen</title>`
 * and a full-screen dark panel — announcing that a kitchen page exists on this
 * site to anyone who mistyped a URL. Measured, not theorised: /orders and
 * /kitchen both came back titled "Kitchen" with the slug set to something else.
 *
 * So the title and the noindex are produced HERE, only when the slug matches,
 * and the board's chrome is rendered inside the page rather than around it. A
 * wrong slug now renders the application's ordinary 404 and nothing else.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ kitchenSlug: string }>;
}): Promise<Metadata> {
  const { kitchenSlug } = await params;
  if (!isKitchenSlug(kitchenSlug)) return {};
  return {
    title: "Kitchen",
    robots: {
      index: false,
      follow: false,
      nocache: true,
      googleBot: { index: false, follow: false },
    },
  };
}

/**
 * The board's own surface.
 *
 * Covers the site chrome rather than removing it. The marketing header, footer
 * and sticky order bar live in the ROOT layout, and the only way to genuinely
 * drop them is a second root layout — which means moving every marketing route
 * into a route group. Not worth that blast radius for a staff screen: a fixed,
 * opaque, top-of-stack surface is visually identical and touches nothing else.
 */
function BoardSurface({ children }: { children: React.ReactNode }) {
  return (
    <div
      // The marker root-layout widgets check to opt themselves out. Covering
      // the chrome hides it visually but leaves it in the DOM, so anything
      // FOCUSABLE down there is still reachable by Tab from this screen —
      // see BackToTop, which reads this attribute and refuses to appear.
      data-kitchen-surface=""
      className="fixed inset-0 z-[100] overflow-y-auto bg-ink text-ivory"
    >
      {children}
    </div>
  );
}

export default async function KitchenPage({
  params,
}: {
  params: Promise<{ kitchenSlug: string }>;
}) {
  const { kitchenSlug } = await params;
  if (!isKitchenSlug(kitchenSlug)) notFound();

  if (!isKitchenAuthConfigured()) {
    return (
      <BoardSurface>
        <main className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-3 px-6 text-center">
          <h1 className="font-display text-3xl text-gold">Kitchen board</h1>
          <p className="text-ivory/80">
            Set <code className="text-gold">ADMIN_DASH_PASSWORD</code> to enable
            this screen. It stays closed until you do.
          </p>
        </main>
      </BoardSurface>
    );
  }

  if (!(await hasKitchenSession())) {
    return (
      <BoardSurface>
        <KitchenLogin />
      </BoardSurface>
    );
  }

  const tenant = publicTenant();
  return (
    <BoardSurface>
      <KitchenBoard
        timezone={tenant.timezone}
        businessDate={businessDateFor(tenant.timezone)}
        ordersConfigured={isOrdersDbConfigured()}
        printingConfigured={cloudPrntConfigured()}
      />
    </BoardSurface>
  );
}
