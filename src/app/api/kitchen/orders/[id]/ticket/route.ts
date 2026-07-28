import { publicTenant } from "@/config/tenant.server";
import { hasKitchenSessionFromRequest } from "@/lib/auth/kitchenSession";
import { getOrderById } from "@/lib/orders/repository";
import { renderTicket } from "@/lib/ticket/render";

/**
 * GET /api/kitchen/orders/[id]/ticket — the ticket image, for the board.
 *
 * The board shows the SAME render that goes to the printer, not a separate
 * HTML rendition. When staff are reading an order off the tablet because the
 * printer died, the two must not be able to disagree.
 *
 * Node runtime: satori and resvg both need it.
 */
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!hasKitchenSessionFromRequest(request)) {
    return new Response("unauthorized", { status: 401 });
  }

  const { id } = await params;
  const orderId = Number.parseInt(id, 10);
  if (!Number.isFinite(orderId)) {
    return new Response("bad order id", { status: 400 });
  }

  const tenant = publicTenant();
  const order = await getOrderById(tenant.tenantId, orderId);
  if (!order) return new Response("not found", { status: 404 });

  const png = await renderTicket(order, { timezone: tenant.timezone });

  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      // The ticket changes when the order does; never let a tablet hold a
      // stale one.
      "cache-control": "no-store",
    },
  });
}
