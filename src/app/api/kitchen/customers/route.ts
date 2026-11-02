import { publicTenant } from "@/config/tenant.server";
import { hasKitchenSessionFromRequest } from "@/lib/auth/kitchenSession";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import { recentOrdersForPhone } from "@/lib/orders/repository";
import { normalizePhone } from "@/lib/phone";

/**
 * GET /api/kitchen/customers?phone=…: the POS's repeat-customer autofill.
 *
 * The last three orders under this number, for THIS tenant, newest first, in
 * one query. There is no customer table; the order history is the memory.
 * Returns the name from the most recent order so staff can greet a regular,
 * and each order's lines so 再點一次 can load them back into the ticket.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!hasKitchenSessionFromRequest(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isOrdersDbConfigured()) {
    return Response.json({ ok: true, name: null, orders: [] });
  }

  const raw = new URL(request.url).searchParams.get("phone") ?? "";
  const phone = normalizePhone(raw);
  if (!phone.ok || !phone.e164) {
    return Response.json({ ok: false, error: "invalid phone" }, { status: 400 });
  }

  try {
    const orders = await recentOrdersForPhone(publicTenant().tenantId, phone.e164, 3);
    return Response.json(
      {
        ok: true,
        name: orders[0]?.customer.name ?? null,
        orders: orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          businessDate: o.businessDate,
          createdAt: o.createdAt,
          channel: o.channel,
          totalCents: o.totals.totalCents,
          items: o.items,
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error(
      "[kitchen-customers] lookup failed:",
      err instanceof Error ? err.message : "unknown error",
    );
    return Response.json({ ok: false, error: "lookup failed" }, { status: 503 });
  }
}
