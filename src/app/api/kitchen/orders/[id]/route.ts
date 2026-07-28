import { z } from "zod";
import { publicTenant } from "@/config/tenant.server";
import { hasKitchenSessionFromRequest } from "@/lib/auth/kitchenSession";
import { getOrderById, updateStatus } from "@/lib/orders/repository";
import { printOrder } from "@/lib/print/dispatch";

/**
 * POST /api/kitchen/orders/[id] — the board's actions: 接單 / 完成 / 重印.
 *
 * Every action re-checks the session server-side. The client never decides
 * what it is allowed to do; it only asks.
 */
export const runtime = "nodejs";

const BodySchema = z
  .object({
    action: z.enum(["accept", "complete", "cancel", "reprint"]),
  })
  .strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!hasKitchenSessionFromRequest(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const orderId = Number.parseInt(id, 10);
  if (!Number.isFinite(orderId)) {
    return Response.json({ ok: false, error: "bad order id" }, { status: 400 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const tenant = publicTenant();

  // Scoped by tenant, so one restaurant's board can never touch another's
  // orders even with a guessed id.
  const order = await getOrderById(tenant.tenantId, orderId);
  if (!order) {
    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  }

  if (body.action === "reprint") {
    const result = await printOrder(order, { reprint: true });
    if (result.skipped) {
      return Response.json({
        ok: false,
        error: "No printer is configured — this order is on the board only.",
      });
    }
    if (!result.printed) {
      return Response.json({
        ok: false,
        error: `Print failed: ${result.error ?? "unknown error"}`,
      });
    }
    const refreshed = await getOrderById(tenant.tenantId, orderId);
    return Response.json({ ok: true, order: refreshed });
  }

  const nextStatus =
    body.action === "accept"
      ? "ACCEPTED"
      : body.action === "complete"
        ? "COMPLETED"
        : "CANCELLED";

  const updated = await updateStatus(tenant.tenantId, orderId, nextStatus);
  return Response.json({ ok: true, order: updated });
}
