import { publicTenant } from "@/config/tenant.server";
import { hasKitchenSessionFromRequest } from "@/lib/auth/kitchenSession";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import { listOrderRevisions } from "@/lib/orders/repository";

/**
 * GET /api/kitchen/orders/[id]/revisions: 改單 edit history for one order.
 * Each saved edit newest first (time, actor, its diff, total before and
 * after), the order as placed, and its change tickets. Read by the History
 * card's 修改紀錄 panel when it is opened.
 */
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!hasKitchenSessionFromRequest(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isOrdersDbConfigured()) {
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
  const { id } = await params;
  const orderId = Number.parseInt(id, 10);
  if (!Number.isFinite(orderId)) {
    return Response.json({ ok: false, error: "bad order id" }, { status: 400 });
  }
  const view = await listOrderRevisions(publicTenant().tenantId, orderId);
  if (!view) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  return Response.json({ ok: true, ...view }, { headers: { "cache-control": "no-store" } });
}
