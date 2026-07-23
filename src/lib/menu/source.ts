import "server-only";

import { unstable_cache } from "next/cache";
import { fetchInventory } from "@/lib/clover/inventory";
import { logNormalizeReport, normalizeInventory } from "@/lib/menu/normalize";
import { readSnapshot, writeSnapshot } from "@/lib/menu/snapshot";
import { seedMenuData } from "@/data/seed-menu";
import type { Menu } from "@/lib/menu/types";

/**
 * The single menu accessor for the whole app: getMenu().
 *
 * Source is chosen by MENU_SOURCE:
 *   "seed"   (default) — src/data/seed-menu.ts. Works with zero Clover creds,
 *                        so the cart/checkout are testable immediately.
 *   "clover"           — live Clover inventory, with a cache→seed fallback
 *                        chain for resilience.
 *
 * Swapping sources is a one-line env change; nothing downstream imports the
 * seed data or the Clover client directly. This is the "drop-in swap behind
 * an interface" the build requires.
 */

export const MENU_CACHE_TAG = "menu";
const REVALIDATE_SECONDS = 300;

type MenuSourceKind = "seed" | "clover";

function menuSourceKind(): MenuSourceKind {
  return process.env.MENU_SOURCE === "clover" ? "clover" : "seed";
}

/** Seed implementation — synchronous data, wrapped in the Promise interface. */
async function seedMenuSource(): Promise<Menu> {
  return seedMenuData();
}

/**
 * Clover implementation. Live read → last-good Supabase snapshot → seed, so a
 * Clover outage degrades to a real menu instead of an error. If Clover returns
 * an empty inventory, we deliberately fall back to seed and warn loudly rather
 * than serve an empty menu.
 */
async function cloverMenuSource(): Promise<Menu> {
  try {
    const fetchedAt = Date.now();
    const raw = await fetchInventory();
    const { menu, report } = normalizeInventory(raw, fetchedAt);
    logNormalizeReport(report);

    // TODO(confirm): map Clover size/price VARIANTS onto MenuItem.sizes[] so
    // party-tray pricing survives the Clover swap. normalizeInventory currently
    // emits a single priceCents per item (itemSizes() then yields one "Regular"
    // tier). Modeling variants correctly needs a live populated merchant to
    // inspect how sizes are represented (item variants vs. a size modifier
    // group). Until then, MENU_SOURCE=clover serves single-size items.

    if (menu.categories.every((cat) => cat.items.length === 0)) {
      console.warn(
        "[menu] Clover inventory came back EMPTY — falling back to the seed menu. " +
          "Check that items are created and available in the Clover dashboard.",
      );
      return seedMenuData();
    }

    // Refresh the outage snapshot. A snapshot write must never take down a
    // working menu read, so failures are logged and swallowed.
    await writeSnapshot(menu).catch((err: unknown) => {
      console.warn(
        "[menu] snapshot write failed:",
        err instanceof Error ? err.message : "unknown error",
      );
    });

    return menu;
  } catch (err) {
    console.warn(
      "[menu] Clover read failed, falling back:",
      err instanceof Error ? err.message : "unknown error",
    );
    const snapshot = await readSnapshot().catch(() => null);
    if (snapshot) return { ...snapshot, source: "cache" };
    return seedMenuData();
  }
}

async function loadMenu(): Promise<Menu> {
  return menuSourceKind() === "clover"
    ? cloverMenuSource()
    : seedMenuSource();
}

/**
 * Cached menu accessor. The clover path caches for REVALIDATE_SECONDS under a
 * tag that POST /api/revalidate-menu can bust. The seed path is effectively
 * static but shares the same cache for a uniform call site.
 */
export const getMenu = unstable_cache(loadMenu, ["menu"], {
  tags: [MENU_CACHE_TAG],
  revalidate: REVALIDATE_SECONDS,
});
