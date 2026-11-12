import "server-only";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasKitchenSession, isKitchenAuthConfigured } from "@/lib/auth/kitchenSession";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import { publicTenant } from "@/config/tenant.server";
import { businessDateFor } from "@/lib/orders/businessDate";
import { listActiveOrders } from "@/lib/orders/repository";
import { stationPrinterHealth } from "@/lib/print/boardPrinters";
import { cloudPrntConfigured } from "@/lib/print/status";
import type { LiveSnapshot } from "@/components/kitchen/KitchenLive";
import { isKitchenSlug, kitchenPath } from "@/lib/kitchenRoute";
import { kitchenLang } from "@/lib/kitchen/i18n.server";
import { kt, type KitchenLang } from "@/lib/kitchen/i18n";
import { KitchenI18nProvider } from "@/components/kitchen/KitchenI18n";
import KitchenLogin from "@/components/kitchen/KitchenLogin";
import KitchenShell, { type KitchenSection } from "@/components/kitchen/KitchenShell";

/**
 * Everything every staff page does before it renders anything of its own.
 *
 *  1. A wrong slug is the application's ordinary 404, indistinguishable from
 *     any unknown path (see lib/kitchenRoute).
 *  2. No ADMIN_DASH_PASSWORD: the screen stays closed and says why.
 *  3. No session: the login form.
 *
 * Returned as a verdict rather than wrapped around children, so a page does
 * not compute its data (the menu, the business date) for a caller who will
 * only ever see the login form.
 */
export type KitchenGuardResult =
  | { ok: true; lang: KitchenLang; basePath: string }
  | { ok: false; node: React.ReactNode };

/**
 * The staff surface. Covers the site chrome rather than removing it: the
 * marketing header, footer and sticky order bar live in the ROOT layout, and a
 * fixed, opaque, top-of-stack surface is visually identical without moving
 * every marketing route into a route group.
 */
function KitchenSurface({ children }: { children: React.ReactNode }) {
  return (
    <div
      // The marker root-layout widgets check to opt themselves out. Covering
      // the chrome hides it visually but leaves it in the DOM, so anything
      // FOCUSABLE down there is still reachable by Tab from this screen;
      // see BackToTop, which reads this attribute and refuses to appear.
      data-kitchen-surface=""
      className="fixed inset-0 z-[100] overflow-y-auto bg-staff-bg font-staff text-staff-ink antialiased"
    >
      {children}
    </div>
  );
}

export async function kitchenGuard(slug: string): Promise<KitchenGuardResult> {
  if (!isKitchenSlug(slug)) notFound();
  const lang = await kitchenLang();

  if (!isKitchenAuthConfigured()) {
    return {
      ok: false,
      node: (
        <KitchenSurface>
          <main className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-3 px-6 text-center">
            <h1 className="text-2xl font-semibold">{kt(lang, "setup.title")}</h1>
            <p className="text-staff-soft">{kt(lang, "setup.body")}</p>
            <code className="mx-auto rounded-sm bg-staff-sunken px-2 py-1 text-staff-ink">{kt(lang, "setup.envName")}</code>
          </main>
        </KitchenSurface>
      ),
    };
  }

  if (!(await hasKitchenSession())) {
    return {
      ok: false,
      node: (
        <KitchenSurface>
          <KitchenI18nProvider initialLang={lang}>
            <KitchenLogin />
          </KitchenI18nProvider>
        </KitchenSurface>
      ),
    };
  }

  return { ok: true, lang, basePath: kitchenPath() };
}

/**
 * Today's orders and both printers, read on the server for the first paint, so
 * a staff screen opens already showing the truth: no skeleton flash and no
 * printer banner popping in a beat later. Null when the read fails; the
 * client's first poll (a second later) then fills it, behind skeletons.
 */
async function firstSnapshot(): Promise<LiveSnapshot | null> {
  if (!isOrdersDbConfigured()) return null;
  const tenant = publicTenant();
  try {
    const [orders, printers] = await Promise.all([
      listActiveOrders(tenant.tenantId, businessDateFor(tenant.timezone), { includeCompleted: true }),
      stationPrinterHealth(tenant.tenantId),
    ]);
    return { orders, printers, printersConfigured: cloudPrntConfigured() };
  } catch (err) {
    console.error(
      "[kitchen] first snapshot failed; the board will load on its first poll:",
      err instanceof Error ? err.message : "unknown error",
    );
    return null;
  }
}

/** The signed-in frame: language, surface, and the one staff shell (header, printers, live orders). */
export async function KitchenFrame({
  lang,
  basePath,
  active,
  children,
}: {
  lang: KitchenLang;
  basePath: string;
  active: KitchenSection;
  children: React.ReactNode;
}) {
  return (
    <KitchenSurface>
      <KitchenI18nProvider initialLang={lang}>
        <KitchenShell
          basePath={basePath}
          active={active}
          ordersConfigured={isOrdersDbConfigured()}
          initial={await firstSnapshot()}
        >
          {children}
        </KitchenShell>
      </KitchenI18nProvider>
    </KitchenSurface>
  );
}

/**
 * Title and noindex, produced ONLY when the slug matches. There is no
 * layout.tsx under [kitchenSlug] for the same reason: a layout wraps the
 * not-found boundary too, and would title every mistyped URL "Kitchen".
 */
export async function kitchenMetadata(slug: string): Promise<Metadata> {
  if (!isKitchenSlug(slug)) return {};
  return {
    title: kt(await kitchenLang(), "meta.title"),
    robots: {
      index: false,
      follow: false,
      nocache: true,
      googleBot: { index: false, follow: false },
    },
  };
}
