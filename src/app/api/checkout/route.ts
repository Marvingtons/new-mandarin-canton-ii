import { z } from "zod";
import { getMenu } from "@/lib/menu/source";
import { indexItems, isAvailable, itemSizes } from "@/lib/menu/types";
import { taxCents } from "@/lib/money";
import { publicTenant, requirePrivateToken } from "@/config/tenant.server";
import { createCharge } from "@/lib/clover/charges";
import { CloverApiError } from "@/lib/clover/client";
import {
  isValidPickup,
  isOpenNow,
  pickupLabel,
  type PickupOptions,
} from "@/lib/order/pickup";
import { resolveOrderLine } from "@/lib/orders/lines";
import {
  createOrder,
  deleteReservation,
  markPaid,
} from "@/lib/orders/repository";
import { businessDateFor, pickupInstant } from "@/lib/orders/businessDate";
import { printOrderInBackground } from "@/lib/print/dispatch";
import { checkRateLimit, rateLimitResponse } from "@/lib/http/rateLimit";
import type { OrderLine } from "@/lib/orders/types";

/**
 * POST /api/checkout — the actual pickup charge.
 *
 * Runs on the Node runtime (needs the ecommerce private token). Hard rules
 * enforced here:
 *   - The client NEVER sends prices. `.strict()` rejects any amount field.
 *   - The server recomputes every price from the menu, in integer cents.
 *   - Idempotency: the order row is RESERVED before Clover is called, so a
 *     duplicate submit loses a unique-index race and never reaches the charge.
 *   - No paid order is persisted on a failed charge (the reservation is
 *     dropped, so the customer can retry with another card).
 *   - Card data / tokens / the private key are never logged.
 */
export const runtime = "nodejs";

const LineSchema = z
  .object({
    lineId: z.string().optional(),
    itemId: z.string().min(1),
    sizeId: z.string().min(1),
    modifierIds: z.array(z.string()).default([]),
    quantity: z.number().int().min(1).max(50),
    specialInstructions: z.string().max(200).optional(),
  })
  .strict(); // a stray `price`/`amount` on a line is a hard reject

const BodySchema = z
  .object({
    lines: z.array(LineSchema).min(1),
    pickup: z
      .object({
        name: z.string().min(1).max(80),
        phone: z.string().min(7).max(30),
        time: z.string().min(1).max(20),
      })
      .strict(),
    cardToken: z.string().startsWith("clv_"),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict(); // a top-level `amount`/`total` is a hard reject

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "127.0.0.1";
}

function bad(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  // 0. Throttle before doing any work. Every request past this point can cost
  //    a Clover charge attempt, which is what makes an open endpoint a
  //    card-testing target.
  const limit = checkRateLimit("checkout", clientIp(request));
  if (!limit.ok) return rateLimitResponse(limit);

  // 1. Parse + validate shape.
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return bad("Your order could not be read. Please rebuild your cart.");
  }

  const tenant = publicTenant();

  // Tax must be configured before we can charge (never guess a rate).
  if (tenant.taxRateBps == null) {
    console.error("[checkout] tax rate is not configured (TENANT_TAX_RATE_BPS)");
    return bad("Online ordering is temporarily unavailable.", 503);
  }

  const pickupOpts: PickupOptions = {
    timezone: tenant.timezone,
    leadMinutes: tenant.pickupLeadMinutes,
    intervalMinutes: tenant.pickupSlotIntervalMinutes,
  };
  const now = new Date();

  // 2. Validate pickup time against real, current store hours.
  if (body.pickup.time === "asap" && !isOpenNow(now, pickupOpts)) {
    return bad("We're closed right now — please choose a time when we're open.");
  }
  if (!isValidPickup(body.pickup.time, now, pickupOpts)) {
    return bad("That pickup time is no longer available. Please pick another.");
  }

  // 3. Recompute the order from the menu — the ONLY source of prices.
  const menu = await getMenu();
  const index = indexItems(menu);

  const resolvedLines: OrderLine[] = [];
  let subtotalCents = 0;
  for (const line of body.lines) {
    const item = index.get(line.itemId);
    if (!item) return bad(`An item is no longer on the menu. Please rebuild your cart.`);
    if (!isAvailable(item)) return bad(`"${item.nameEn}" is currently unavailable.`);
    const size = itemSizes(item).find((s) => s.id === line.sizeId);
    if (!size) return bad(`A size is no longer available for "${item.nameEn}".`);

    // resolveOrderLine wraps the SAME resolveLinePrice the cart uses — it adds
    // the bilingual names the kitchen ticket needs and changes no arithmetic.
    let resolved: OrderLine;
    try {
      resolved = resolveOrderLine(
        item,
        line.sizeId,
        line.modifierIds,
        line.quantity,
        line.specialInstructions,
      );
    } catch {
      return bad(`An option is no longer available for "${item.nameEn}".`);
    }

    subtotalCents += resolved.lineCents;
    resolvedLines.push(resolved);
  }

  const tax = taxCents(subtotalCents, tenant.taxRateBps);
  const totalCents = subtotalCents + tax;
  if (totalCents <= 0) return bad("Your cart is empty.");

  const timeLabel = pickupLabel(body.pickup.time, pickupOpts);

  // 4. Config guard, before we reserve anything: the private token must exist.
  //    (Kept after validation so bad requests still get a clean 400.)
  try {
    requirePrivateToken();
  } catch {
    console.error("[checkout] CLOVER_PRIVATE_TOKEN is not configured");
    return bad("Online payment is temporarily unavailable.", 503);
  }

  // 5. RESERVE the order row before charging.
  //
  //    Order matters: the unique index on (tenant_id, idempotency_key) can
  //    only protect the charge call if the row exists before it. A duplicate
  //    submit loses this insert and is turned away below, having never
  //    touched Clover. The reservation also allocates the daily number
  //    atomically, so two customers cannot be handed the same one.
  const businessDate = businessDateFor(tenant.timezone, now);
  let reserved;
  try {
    reserved = await createOrder({
      tenantId: tenant.tenantId,
      businessDate,
      orderNumberPrefix: tenant.orderNumberPrefix,
      idempotencyKey: body.idempotencyKey,
      items: resolvedLines,
      totals: {
        subtotalCents,
        taxCents: tax,
        // TODO(confirm): tips are not offered on pickup yet (TIP_PRESETS
        // unset). The column exists so enabling them is not a migration.
        tipCents: 0,
        totalCents,
      },
      customer: { name: body.pickup.name, phone: body.pickup.phone },
      pickupAt: pickupInstant(
        body.pickup.time,
        tenant.timezone,
        tenant.pickupLeadMinutes,
        now,
      ),
    });
  } catch (err) {
    console.error(
      "[checkout] could not reserve an order:",
      err instanceof Error ? err.message : "unknown error",
    );
    return bad("We couldn't start your order. Please try again.", 503);
  }

  // 6. Idempotent replay — this key already has a row, so it already has (or
  //    is mid-flight on) a charge. Return the original; never charge twice.
  if (!reserved.created) {
    const prior = reserved.order;
    if (prior.status === "PENDING_PAYMENT") {
      // A concurrent submit is between reserve and charge right now.
      return bad(
        "Your order is already being processed. Please wait a moment before retrying.",
        409,
      );
    }
    return Response.json({
      ok: true,
      orderNumber: prior.orderNumber,
      chargeId: prior.chargeId,
      total: prior.totals.totalCents,
      pickupTime: timeLabel,
      idempotentReplay: true,
    });
  }

  const order = reserved.order;

  // 7. Charge.
  let chargeId: string;
  try {
    const charge = await createCharge({
      amountCents: totalCents,
      source: body.cardToken,
      clientIp: clientIp(request),
      idempotencyKey: body.idempotencyKey,
      metadata: {
        orderNumber: order.orderNumber,
        customerName: body.pickup.name,
        phone: body.pickup.phone,
        pickupTime: timeLabel,
      },
    });
    if (!charge.id) throw new Error("charge returned no id");
    chargeId = charge.id;
  } catch (err) {
    // Drop the reservation so the customer can retry with another card. The
    // freed number is not reused; a gap is cheaper than a wrong number.
    await deleteReservation(tenant.tenantId, order.id).catch(() => {
      console.warn("[checkout] could not release reservation", order.orderNumber);
    });

    // Clean, human error. Never persist a paid order on a failed charge.
    if (err instanceof CloverApiError) {
      // Log only the safe, credential-free error (see client.ts).
      console.warn("[checkout] charge failed:", err.message);
      if (err.isAuthOrPermission) {
        return bad("Online payment is temporarily unavailable.", 503);
      }
      return bad(
        "Your card was declined or could not be processed. Please try another card.",
        402,
      );
    }
    console.warn("[checkout] charge failed (non-Clover error)");
    return bad("We couldn't process your payment. Please try again.", 502);
  }

  // 8. Promote the reservation to a paid order.
  const paid = await markPaid(tenant.tenantId, order.id, chargeId);

  // 9. Print out of band. The customer has already paid and the row is
  //    committed, so a dead printer must not slow or break this response —
  //    the /kitchen board is the fallback either way.
  printOrderInBackground(paid);

  return Response.json({
    ok: true,
    orderNumber: paid.orderNumber,
    chargeId,
    total: totalCents,
    pickupTime: timeLabel,
  });
}
