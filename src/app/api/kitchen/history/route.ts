import { publicTenant } from "@/config/tenant.server";
import { hasKitchenSessionFromRequest } from "@/lib/auth/kitchenSession";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import { parseHistoryParams } from "@/lib/orders/history";
import { listOrders } from "@/lib/orders/repository";

/**
 * GET /api/kitchen/history: one page (50) of order history plus the range's
 * totals. Filters and paging are server-side; see lib/orders/history for the
 * one shared reading of the query string.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!hasKitchenSessionFromRequest(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isOrdersDbConfigured()) {
    return Response.json(
      { ok: false, error: "The order database is not configured (DATABASE_URL)." },
      { status: 503 },
    );
  }
  const parsed = parseHistoryParams(new URL(request.url).searchParams);
  if (!parsed) {
    return Response.json({ ok: false, error: "bad range or filter" }, { status: 400 });
  }
  try {
    const page = await listOrders(publicTenant().tenantId, parsed.query, parsed.page);
    return Response.json({ ok: true, ...page }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error(
      "[kitchen-history] list failed:",
      err instanceof Error ? err.message : "unknown error",
    );
    return Response.json({ ok: false, error: "Could not load history." }, { status: 503 });
  }
}
