import { publicTenant } from "@/config/tenant.server";
import { hasKitchenSessionFromRequest } from "@/lib/auth/kitchenSession";
import { getOrderById } from "@/lib/orders/repository";
import { composeTicketSvg, renderTicket } from "@/lib/ticket/render";
import type { TicketCopyRole } from "@/lib/ticket/copies";

/**
 * GET /api/kitchen/orders/[id]/ticket — the ticket image, for the board.
 *
 * The board shows the SAME render that goes to the printer, not a separate
 * HTML rendition. When staff are reading an order off the tablet because the
 * printer died, the two must not be able to disagree.
 *
 * `?copy=kitchen` or `?copy=register` renders that one copy of the printed
 * pair, as the printer gets it; without it, the single all-in-one ticket.
 * `&format=text` answers with what the copy lays out (each line's text and
 * what it printed in money) instead of the image, so a browser test can
 * check a copy without reading pixels.
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

  const url = new URL(request.url);
  const copy = url.searchParams.get("copy");
  const roles: TicketCopyRole[] = ["kitchen", "register"];
  const options =
    copy === "kitchen" || copy === "register"
      ? { timezone: tenant.timezone, copies: 2, copyIndex: roles.indexOf(copy), copyRoles: roles }
      : { timezone: tenant.timezone };

  if (url.searchParams.get("format") === "text") {
    const { lines, money } = await composeTicketSvg(order, options);
    return Response.json(
      { lines: lines.map((l) => l.text), money: money[0] ?? null },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const png = await renderTicket(order, options);

  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      // The ticket changes when the order does; never let a tablet hold a
      // stale one.
      "cache-control": "no-store",
    },
  });
}
