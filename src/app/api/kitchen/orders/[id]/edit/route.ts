import { publicTenant } from "@/config/tenant.server";
import { kitchenSessionKey } from "@/lib/auth/kitchenSession";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import { checkRateLimit, rateLimitResponse } from "@/lib/http/rateLimit";
import { previewOrderingBlocked } from "@/lib/http/deployHost";
import { getMenu } from "@/lib/menu/source";
import { formatCents } from "@/lib/money";
import { isGateBypassRequest } from "@/lib/order/bypass";
import type { PickupOptions } from "@/lib/order/pickup";
import { staffLunchAllowed } from "@/lib/orders/compose";
import { priceEdit } from "@/lib/orders/editPricing";
import { getOrderById, saveOrderEdit } from "@/lib/orders/repository";
import { OrderEditRequestSchema, type OrderEditRequest } from "@/lib/orders/requestSchema";
import { diffOrderLines, isEmptyDiff } from "@/lib/orders/revisionDiff";
import { isEditable, type Order } from "@/lib/orders/types";

/**
 * POST /api/kitchen/orders/[id]/edit: 改單 EDIT ORDER. See docs/edit-order.md.
 *
 * The POS sends the whole edited ticket (no prices); the server prices it
 * (lib/orders/editPricing.ts: untouched lines keep their stored price, new or
 * changed lines go through composeOrder, lunch judged at the ORIGINAL order
 * time), diffs it against the order, and saves it in one transaction that
 * snapshots the previous version and queues the change ticket
 * (repository saveOrderEdit). `dryRun` does everything but the write: the
 * confirm sheet shows the server's own diff and totals.
 *
 * Answers: 200 { ok, revision, diff, totals, oldTotals, print, changeTicket,
 * replaced, duplicate }, or { ok: false, code } with 409 conflict /
 * change_printing / not_editable, 422 no_changes / empty, 400 for a request or
 * a line it cannot price.
 *
 * Refused on a preview host, like every write that can reach a real printer.
 */
export const runtime = "nodejs";

type EditError =
  | "unauthorized"
  | "bad_request"
  | "not_found"
  | "not_editable"
  | "conflict"
  | "change_printing"
  | "no_changes"
  | "empty"
  | "item_unavailable"
  | "rejected"
  | "unavailable";

const MESSAGES: Record<Exclude<EditError, "item_unavailable" | "rejected">, string> = {
  unauthorized: "unauthorized",
  bad_request: "The edit could not be read. · 無法讀取改單。",
  not_found: "Order not found. · 找不到訂單。",
  not_editable: "This order can no longer be edited. · 此單已不能修改。",
  conflict: "This order was changed on another tablet. Reopen it. · 此單已在另一部平板修改，請重新開啟。",
  change_printing: "A change ticket is printing for this order. Try again in a moment. · 改單正在列印，請稍後再試。",
  no_changes: "Nothing changed. · 沒有更改。",
  empty: "An order cannot have no dishes. Use Cancel to void it. · 不能刪除全部，請用取消訂單。",
  unavailable: "Could not save the edit. Please try again. · 無法儲存改單，請重試。",
};

const STATUS: Record<EditError, number> = {
  unauthorized: 401,
  bad_request: 400,
  not_found: 404,
  not_editable: 409,
  conflict: 409,
  change_printing: 409,
  no_changes: 422,
  empty: 422,
  item_unavailable: 400,
  rejected: 400,
  unavailable: 503,
};

function refuse(code: EditError, message?: string): Response {
  return Response.json(
    { ok: false, code, error: message ?? MESSAGES[code as keyof typeof MESSAGES] ?? code },
    { status: STATUS[code] },
  );
}

/** What the kitchen's printer will get from this edit, for the confirm sheet. */
function printOutcome(order: Order, printChange: boolean): "change" | "replace" | "none" {
  if (order.status === "COMPLETED" && !printChange) return "none";
  if (order.ticketRevision === null || order.status === "PRINT_FAILED") return "replace";
  return "change";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const blocked = previewOrderingBlocked(request);
  if (blocked) return blocked;

  const sessionKey = kitchenSessionKey(request);
  if (!sessionKey) return refuse("unauthorized");

  const limit = checkRateLimit("kitchen_order_session", sessionKey);
  if (!limit.ok) return rateLimitResponse(limit);

  if (!isOrdersDbConfigured()) return refuse("unavailable");

  const { id } = await params;
  const orderId = Number.parseInt(id, 10);
  if (!Number.isFinite(orderId)) return refuse("bad_request");

  let body: OrderEditRequest;
  try {
    body = OrderEditRequestSchema.parse(await request.json());
  } catch {
    return refuse("bad_request");
  }

  const tenant = publicTenant();
  if (tenant.taxRateBps == null) return refuse("unavailable", "Tax rate is not configured. · 稅率未設定。");

  const order = await getOrderById(tenant.tenantId, orderId);
  if (!order) return refuse("not_found");
  // The board hides Edit by the same rule; this is the half a stale tablet
  // cannot get around. The repository checks it again under the row lock.
  if (!isEditable(order, Date.now())) return refuse("not_editable");
  // The revision is NOT checked here: a repeat of a save that already won
  // must be answered with that save (the repository looks the token up first,
  // under the row lock), not reported as a conflict with itself.
  if (body.lines.length === 0) return refuse("empty");

  const pickupOpts: PickupOptions = {
    timezone: tenant.timezone,
    leadMinutes: tenant.pickupLeadMinutes,
    intervalMinutes: tenant.pickupSlotIntervalMinutes,
  };
  const priced = priceEdit(await getMenu(), order.items, body.lines, {
    taxRateBps: tenant.taxRateBps,
    // Lunch is judged at the ORIGINAL order's time, not now.
    lunchAllowed: staffLunchAllowed({
      now: new Date(order.createdAt),
      opts: pickupOpts,
      override: body.lunchOverride === true,
      bypass: isGateBypassRequest(request),
    }),
  });
  if (!priced.ok) {
    return refuse(priced.reason === "item_unavailable" ? "item_unavailable" : "rejected", priced.error);
  }

  const printChange = body.printChange === true;
  if (body.dryRun) {
    const diff = diffOrderLines(order.items, priced.lines);
    return Response.json(
      {
        ok: true,
        dryRun: true,
        noChanges: isEmptyDiff(diff),
        revision: order.revision,
        diff,
        totals: priced.totals,
        oldTotals: order.totals,
        print: printOutcome(order, printChange),
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const result = await saveOrderEdit(tenant.tenantId, {
      orderId,
      baseRevision: body.baseRevision,
      editToken: `pos-edit:${body.editToken}`,
      items: priced.lines,
      totals: priced.totals,
      // The board is one shared session with no per-person identity
      // (kitchenSession.ts), as for 重印.
      actor: "kitchen",
      printChange,
      // A web customer was quoted a total online and pays at the counter:
      // the note says what it was. Never printed.
      staffNoteLine:
        order.channel === "web"
          ? `已改單 edited by staff, was ${formatCents(order.totals.totalCents)}`
          : null,
    });
    if (result.kind !== "saved") return refuse(result.kind);
    console.info(
      `[kitchen-edit] ${result.order.orderNumber} revision ${result.revision}` +
        (result.duplicate ? " (repeat of a saved edit)" : "") +
        (result.replaced ? ": never printed, contents replaced" : "") +
        (result.changeTicket ? `: change ticket ${result.changeTicketId}` : ""),
    );
    return Response.json(
      {
        ok: true,
        revision: result.revision,
        diff: result.diff,
        totals: result.order.totals,
        oldTotals: order.totals,
        changeTicket: result.changeTicket,
        changeTicketId: result.changeTicketId,
        replaced: result.replaced,
        duplicate: result.duplicate,
        order: result.order,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[kitchen-edit] could not save:", err instanceof Error ? err.message : "unknown error");
    return refuse("unavailable");
  }
}
