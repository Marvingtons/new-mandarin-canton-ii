import "server-only";

import { publicTenant } from "@/config/tenant.server";
import { db, isDbConfigured } from "@/lib/db/supabase";
import type { Menu } from "@/lib/menu/types";

/**
 * Last-good menu snapshot, persisted in Supabase.
 *
 * Purpose is availability, not truth: when Clover is unreachable the site
 * serves this so customers can still read the menu. It is never a basis for
 * taking a payment — getMenu tags it `source: "cache"` and checkout requires
 * `source: "clover"`.
 *
 * Every operation degrades quietly when Supabase is not configured, so local
 * development without credentials still boots.
 */

const TABLE = "menu_snapshots";

export async function writeSnapshot(menu: Menu): Promise<void> {
  if (!isDbConfigured()) return;
  const { tenantId } = publicTenant();

  const { error } = await db()
    .from(TABLE)
    .upsert(
      {
        tenant_id: tenantId,
        payload: menu,
        fetched_at: menu.fetchedAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id" },
    );

  if (error) throw new Error(`snapshot upsert failed: ${error.message}`);
}

export async function readSnapshot(): Promise<Menu | null> {
  if (!isDbConfigured()) return null;
  const { tenantId } = publicTenant();

  const { data, error } = await db()
    .from(TABLE)
    .select("payload")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !data) return null;
  const payload = (data as { payload?: Menu }).payload;
  return payload ?? null;
}
