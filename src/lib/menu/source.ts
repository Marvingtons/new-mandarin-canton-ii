import "server-only";

import { catalogMenu } from "@/lib/menu/catalog";
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
  return catalogMenu();
}
