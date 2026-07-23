import { z } from "zod";
import { getMenu } from "@/lib/menu/source";
import { indexItems, isAvailable, itemSizes } from "@/lib/menu/types";
import { resolveLinePrice } from "@/lib/cart/pricing";
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
import {
  localDateKey,
  orderStore,
  type StoredOrderLine,
} from "@/lib/order/store";

/**
 * POST /api/checkout — the actual pickup charge.
 *
 * Runs on the Node runtime (needs the ecommerce private token). Hard rules
 * enforced here:
 *   - The client NEVER sends prices. `.strict()` rejects any amount field.
 *   - The server recomputes every price from the menu, in integer cents.
 *   - Idempotency: a repeated key returns the original result, never charges
 *     twice.
 *   - No order is persisted on a failed charge.
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

  const resolvedLines: StoredOrderLine[] = [];
  let subtotalCents = 0;
  for (const line of body.lines) {
    const item = index.get(line.itemId);
    if (!item) return bad(`An item is no longer on the menu. Please rebuild your cart.`);
    if (!isAvailable(item)) return bad(`"${item.nameEn}" is currently unavailable.`);
    const size = itemSizes(item).find((s) => s.id === line.sizeId);
    if (!size) return bad(`A size is no longer available for "${item.nameEn}".`);

    let priced;
    try {
      priced = resolveLinePrice(item, line.sizeId, line.modifierIds, line.quantity);
    } catch {
      return bad(`An option is no longer available for "${item.nameEn}".`);
    }

    subtotalCents += priced.lineCents;
    resolvedLines.push({
      itemId: item.id,
      nameEn: item.nameEn,
      sizeId: size.id,
      sizeLabel: size.label,
      modifierIds: line.modifierIds,
      quantity: line.quantity,
      unitCents: priced.unitCents,
      lineCents: priced.lineCents,
      specialInstructions: line.specialInstructions,
    });
  }

  const tax = taxCents(subtotalCents, tenant.taxRateBps);
  const totalCents = subtotalCents + tax;
  if (totalCents <= 0) return bad("Your cart is empty.");

  const store = orderStore();

  // 4. Idempotency — a retried submit returns the original charge.
  const existing = await store.findByIdempotencyKey(body.idempotencyKey);
  if (existing) {
    return Response.json({
      ok: true,
      orderNumber: existing.orderNumber,
      chargeId: existing.chargeId,
      total: existing.totalCents,
      pickupTime: existing.pickup.timeLabel,
      idempotentReplay: true,
    });
  }

  // 5. Config guard, right before charging: the private token must exist.
  //    (Kept after validation so bad requests still get a clean 400.)
  try {
    requirePrivateToken();
  } catch {
    console.error("[checkout] CLOVER_PRIVATE_TOKEN is not configured");
    return bad("Online payment is temporarily unavailable.", 503);
  }

  // 6. Allocate an order number and charge.
  const dateKey = localDateKey(tenant.timezone, now);
  const orderNumber = await store.nextOrderNumber(
    tenant.orderNumberPrefix,
    dateKey,
  );
  const timeLabel = pickupLabel(body.pickup.time, pickupOpts);

  let chargeId: string;
  try {
    const charge = await createCharge({
      amountCents: totalCents,
      source: body.cardToken,
      clientIp: clientIp(request),
      idempotencyKey: body.idempotencyKey,
      metadata: {
        orderNumber,
        customerName: body.pickup.name,
        phone: body.pickup.phone,
        pickupTime: timeLabel,
      },
    });
    if (!charge.id) throw new Error("charge returned no id");
    chargeId = charge.id;
  } catch (err) {
    // Clean, human error. Never persist an order on a failed charge.
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

  // 6. Persist the paid order (idempotency re-checked inside create()).
  await store.create({
    orderNumber,
    chargeId,
    idempotencyKey: body.idempotencyKey,
    status: "paid",
    subtotalCents,
    taxCents: tax,
    totalCents,
    pickup: {
      name: body.pickup.name,
      phone: body.pickup.phone,
      time: body.pickup.time,
      timeLabel,
    },
    lines: resolvedLines,
    dateKey,
    createdAt: now.getTime(),
  });

  return Response.json({
    ok: true,
    orderNumber,
    chargeId,
    total: totalCents,
    pickupTime: timeLabel,
  });
}
