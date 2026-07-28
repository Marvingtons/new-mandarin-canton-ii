import { publicTenant } from "@/config/tenant.server";
import { hasKitchenSessionFromRequest } from "@/lib/auth/kitchenSession";
import { businessDateFor } from "@/lib/orders/businessDate";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import { listActiveOrders } from "@/lib/orders/repository";

/**
 * GET /api/kitchen/orders — the board's polling endpoint.
 *
 * Deliberately NOT rate limited: the board polls every 10s by design, and
 * throttling it would blind the kitchen exactly when the restaurant is busy
 * enough to have several tablets open.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!hasKitchenSessionFromRequest(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const tenant = publicTenant();

  if (!isOrdersDbConfigured()) {
    // A missing DATABASE_URL is an operator problem. Say so plainly on the
    // board rather than rendering an empty queue, which reads as "no orders".
    return Response.json({
      ok: false,
      error: "The order database is not configured (DATABASE_URL).",
      orders: [],
    });
  }

  const url = new URL(request.url);
  const includeCompleted = url.searchParams.get("completed") === "1";
  const businessDate =
    url.searchParams.get("date") ?? businessDateFor(tenant.timezone);

  try {
    const orders = await listActiveOrders(tenant.tenantId, businessDate, {
      includeCompleted,
    });
    return Response.json(
      { ok: true, orders, businessDate },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error(
      "[kitchen] order list failed:",
      err instanceof Error ? err.message : "unknown error",
    );
    return Response.json(
      { ok: false, error: "Could not load orders.", orders: [] },
      { status: 503 },
    );
  }
}
