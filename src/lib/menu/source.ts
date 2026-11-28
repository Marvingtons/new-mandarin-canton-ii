import "server-only";

import { catalogMenu, websiteMenu } from "@/lib/menu/catalog";
import type { Menu } from "@/lib/menu/types";

/**
 * The single menu accessor for the whole app.
 *
 * There is exactly one source now: `src/data/menu.ts`, the restaurant's own
 * transcribed catalogue, mapped in `catalog.ts`. The Clover inventory sync, its
 * cache-tag revalidation, the Supabase outage snapshot and the 16-item seed
 * fallback are all deleted — with a local catalogue there is no remote call to
 * fail, so that entire fallback chain existed only to protect against a
 * dependency we no longer have.
 *
 * Kept async so every existing `await getMenu()` call site is unchanged, and so
 * a future remote source could slot in here without touching a caller.
 */
export async function getMenu(): Promise<Menu> {
  // The WEBSITE's menu: no staff-only items (alcohol). The safe default, so
  // a new customer page that calls getMenu() cannot sell a beer.
  return websiteMenu();
}

/**
 * The menu the STAFF order routes price against: everything getMenu() has,
 * plus the staff-only items (beer, house wine) the POS sells. Hidden (86'd)
 * items are still absent, exactly as on the web.
 */
export async function getStaffMenu(): Promise<Menu> {
  return catalogMenu();
}
