import "server-only";

import { unstable_cache } from "next/cache";
import { fetchInventory } from "@/lib/clover/inventory";
import { logNormalizeReport, normalizeInventory } from "@/lib/menu/normalize";
import { readSnapshot, writeSnapshot } from "@/lib/menu/snapshot";
import { seedMenu } from "@/lib/menu/seed";
import type { Menu } from "@/lib/menu/types";

/**
 * The menu the site serves, cached and resilient.
 *
 * Fallback chain, best to worst:
 *   1. clover — a live read. The ONLY source permitted to back a payment.
 *   2. cache  — the last-good Supabase snapshot, when Clover is unreachable.
 *   3. seed   — the static file that predates this integration; last resort so
 *              the page still renders a real menu rather than an error.
 *
 * Checkout must refuse to charge unless `source === "clover"` (see the Phase 3
 * security requirement): taking a card against stale or hand-maintained prices
 * is exactly the failure the price-integrity review flagged.
 *
 * Caching uses the Previous Model (this repo does not enable cacheComponents),
 * so `unstable_cache` with a tag is correct. The tag is busted on demand by
 * POST /api/revalidate-menu.
 */

export const MENU_CACHE_TAG = "menu";
const REVALIDATE_SECONDS = 300;

async function loadMenu(): Promise<Menu> {
  try {
    const fetchedAt = Date.now();
    const raw = await fetchInventory();
    const { menu, report } = normalizeInventory(raw, fetchedAt);
    logNormalizeReport(report);

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

    return seedMenu();
  }
}

/**
 * Cached menu accessor. Note the cache stores whichever tier answered, so a
 * Clover outage is remembered for at most REVALIDATE_SECONDS — the banner
 * driven by `source` clears itself once Clover recovers and the tag expires.
 */
export const getMenu = unstable_cache(loadMenu, ["menu"], {
  tags: [MENU_CACHE_TAG],
  revalidate: REVALIDATE_SECONDS,
});
