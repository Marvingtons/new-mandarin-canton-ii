import { z } from "zod";
import { cancelPin, publicTenant } from "@/config/tenant.server";
import { hasKitchenSessionFromRequest, kitchenSessionKey } from "@/lib/auth/kitchenSession";
import {
  CANCEL_PIN_ACTOR,
  cancelPinCooldown,
  cancelPinMatches,
  recordCancelPinFailure,
} from "@/lib/auth/cancelPin";
import {
  cancelOrder,
  getOrderById,
  requestReprint,
  updateStatus,
  undoDone,
} from "@/lib/orders/repository";
import { notifyOrderReady } from "@/lib/notify/orderReady";
import { previewOrderingBlocked } from "@/lib/http/deployHost";
import { STATIONS } from "@/config/stations";

/**
 * POST /api/kitchen/orders/[id] — the board's actions: 接單 / 完成 / 重印.
 *
 * Every action re-checks the session server-side. The client never decides
 * what it is allowed to do; it only asks.
 *
 * Refused on a preview host before anything else: 重印 queues a real ticket on
 * the production printer, and 完成 / notify can text a real customer.
 */
export const runtime = "nodejs";

const BodySchema = z.strictObject({
  action: z.enum(["accept", "complete", "cancel", "reprint", "notify", "undo"]),
  /** Why, for a cancel. Stored on staff_note; never printed. */
  note: z.string().max(500).optional(),
  /** For a cancel: the manager PIN (CANCEL_PIN). Checked here, never echoed. */
  pin: z.string().max(16).optional(),
  /**
   * For a reprint: which printer. Omitted = the station it is already on,
   * which is what the picker preselects.
   */
  station: z.enum(STATIONS).optional(),
  /** 改單: reprint this stored change ticket rather than the full ticket. */
  changeTicketId: z.string().uuid().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const blocked = previewOrderingBlocked(request);
  if (blocked) return blocked;

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

  if (body.action === "undo") {
    const restored = await undoDone(tenant.tenantId, orderId);
    return restored
      ? Response.json({ ok: true, order: restored })
      : Response.json({ ok: false, error: "This order can no longer be undone." }, { status: 409 });
  }

  // 重印 — ask for one more copy. We do NOT push to the printer: CloudPRNT is
  // pull-based, so a reprint records a manual_reprint request (with the
  // station picked) and the next poll of that printer collects it. The order's
  // status is not touched, so it stays where it is on the board. The actor is
  // "kitchen": the board is a single shared session with no per-person
  // identity (see kitchenSession.ts).
  if (body.action === "reprint") {
    const requeued = await requestReprint(
      tenant.tenantId,
      orderId,
      "kitchen",
      body.station,
      body.changeTicketId ?? null,
    );
    // requestReprint refuses a CANCELLED order (never offered again) and an
    // order the printer is printing right now (one live delivery at a time).
    if (!requeued) {
      const now = await getOrderById(tenant.tenantId, orderId);
      if (now?.status === "CANCELLED") {
        return Response.json(
          { ok: false, code: "cancelled", error: "A cancelled order cannot be reprinted." },
          { status: 409 },
        );
      }
      return Response.json(
        {
          ok: false,
          code: "printing",
          error: "The printer is printing this ticket now. Wait a minute, then reprint if it does not come out.",
        },
        { status: 409 },
      );
    }
    return Response.json({
      ok: true,
      order: requeued,
      notice: "Sent to the printer. It prints within a few seconds.",
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

  // 取消: CANCELLED, with the reason on staff_note, and the print pointer
  // cleared so nothing reads as in flight. Never re-offered to the printer.
  //
  // MANAGER PIN. Staff take, print and edit orders on the board password
  // alone; cancelling one needs CANCEL_PIN as well, checked HERE (the client
  // never learns it). No PIN: 401. Wrong: 403, and counted per tablet
  // session; 5 wrong in 10 minutes: 429 for 60 seconds (lib/auth/cancelPin).
  // Undo of a cancel is the "undo" action above and needs no PIN.
  if (body.action === "cancel") {
    const expected = cancelPin();
    if (expected === null) {
      return Response.json(
        { ok: false, code: "pin_unconfigured", error: "No cancel PIN is set (CANCEL_PIN)." },
        { status: 503 },
      );
    }
    if (!body.pin) {
      return Response.json({ ok: false, code: "pin_required", error: "The manager PIN is required to cancel." }, { status: 401 });
    }
    const sessionKey = kitchenSessionKey(request) ?? "unknown";
    const wait = await cancelPinCooldown(tenant.tenantId, sessionKey);
    if (wait > 0) {
      return Response.json(
        { ok: false, code: "pin_cooldown", retryAfterSeconds: wait, error: "Too many wrong PINs. Wait, then try again." },
        { status: 429, headers: { "retry-after": String(wait) } },
      );
    }
    if (!cancelPinMatches(body.pin, expected)) {
      const after = await recordCancelPinFailure(tenant.tenantId, sessionKey);
      return Response.json(
        { ok: false, code: "pin_wrong", retryAfterSeconds: after, error: "Wrong PIN." },
        { status: 403 },
      );
    }
    const cancelled = await cancelOrder(tenant.tenantId, orderId, body.note ?? null, CANCEL_PIN_ACTOR);
    return Response.json({ ok: true, order: cancelled ?? order });
  }

  const nextStatus = body.action === "accept" ? "ACCEPTED" : "COMPLETED";

  const updated = await updateStatus(tenant.tenantId, orderId, nextStatus);

  // Courtesy text when the food is ready. Fire and forget: an SMS that does
  // not send must never make the kitchen think 完成 failed.
  //
  // WEB ORDERS ONLY. A web customer agreed to texts when they verified their
  // number on the site; a phone or walk-in customer gave a number to a person
  // and saw no such notice. Owner confirmed: do not text phone or walk-in
  // customers.
  // TODO(consent): if the POS ever gets an "ok to text?" checkbox, gate on that
  // stored consent here, not on the channel. Not built.
  if (updated && body.action === "complete" && updated.channel === "web") {
    void notifyOrderReady(updated).catch(() => {
      /* already logged inside */
    });
  }

  return Response.json({ ok: true, order: updated });
}
