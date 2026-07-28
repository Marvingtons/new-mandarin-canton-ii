import { z } from "zod";
import { publicTenant } from "@/config/tenant.server";
import { hasKitchenSessionFromRequest } from "@/lib/auth/kitchenSession";
import {
  getOrderById,
  requeueForPrint,
  updateStatus,
} from "@/lib/orders/repository";
import { notifyOrderReady } from "@/lib/notify/orderReady";

/**
 * POST /api/kitchen/orders/[id] — the board's actions: 接單 / 完成 / 重印.
 *
 * Every action re-checks the session server-side. The client never decides
 * what it is allowed to do; it only asks.
 */
export const runtime = "nodejs";

const BodySchema = z
  .object({
    action: z.enum(["accept", "complete", "cancel", "reprint", "notify"]),
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

  // 重印 — put the job back in the queue. We do NOT push to the printer:
  // CloudPRNT is pull-based, so "reprint" means making the job claimable again
  // and letting the next poll (seconds away) collect it.
  if (body.action === "reprint") {
    const requeued = await requeueForPrint(tenant.tenantId, orderId);
    return Response.json({
      ok: true,
      order: requeued,
      notice: "Re-queued — the printer will pick it up on its next poll.",
    });
  }

  // Manual "text the customer it's ready" without advancing the order.
  if (body.action === "notify") {
    const result = await notifyOrderReady(order);
    return Response.json(
      result.sent
        ? { ok: true, order, notice: "Customer notified." }
        : { ok: false, error: result.error ?? "Could not send the text." },
    );
  }

  const nextStatus =
    body.action === "accept"
      ? "ACCEPTED"
      : body.action === "complete"
        ? "COMPLETED"
        : "CANCELLED";

  const updated = await updateStatus(tenant.tenantId, orderId, nextStatus);

  // Courtesy text when the food is ready. Fire and forget: an SMS that does
  // not send must never make the kitchen think 完成 failed.
  if (updated && body.action === "complete") {
    void notifyOrderReady(updated).catch(() => {
      /* already logged inside */
    });
  }

  return Response.json({ ok: true, order: updated });
}
