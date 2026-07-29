import { phonesSentence } from "@/data/restaurant";
import { z } from "zod";
import { getMenu } from "@/lib/menu/source";
import { indexItems, isAvailable, itemSizes } from "@/lib/menu/types";
import { taxCents } from "@/lib/money";
import { orderCaps, publicTenant } from "@/config/tenant.server";
import {
  isValidPickup,
  isOpenNow,
  pickupLabel,
  type PickupOptions,
} from "@/lib/order/pickup";
import { resolveOrderLine } from "@/lib/orders/lines";
import { countOrdersForPhone, createOrder } from "@/lib/orders/repository";
import { businessDateFor, pickupInstant } from "@/lib/orders/businessDate";
import { readVerifiedPhoneFromRequest } from "@/lib/otp/session";
import { normalizePhone } from "@/lib/phone";
import { checkRateLimit, rateLimitResponse } from "@/lib/http/rateLimit";
import { clientIp } from "@/lib/http/clientIp";
import type { OrderLine } from "@/lib/orders/types";

/**
 * POST /api/orders — submit a pickup order.
 *
 * Nothing is charged. The customer pays at the counter, which changes what
 * this endpoint has to protect against: not card fraud, but a stranger making
 * the kitchen cook food nobody collects. The controls that replace payment:
 *
 *   - A VERIFIED PHONE, proved by an httpOnly signed cookie. The number the
 *     order is filed under is read out of that token, never off the request
 *     body, so there is no field a client can set to fake verification.
 *   - A PER-PHONE DAILY CAP, counted in Postgres — not in the in-memory
 *     limiter, because a serverless instance boundary must not reset it.
 *   - Server-recomputed prices. We are not taking the money, but the ticket
 *     total is what the customer is quoted and the register keys against, so
 *     a client-supplied amount is still a lie we refuse to print.
 *
 * The order is live the instant it is stored: status QUEUED, waiting for the
 * printer to claim it.
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
    lines: z.array(LineSchema).min(1).max(60),
    pickup: z
      .object({
        name: z.string().min(1).max(80),
        phone: z.string().min(7).max(32),
        time: z.string().min(1).max(20),
      })
      .strict(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict(); // a top-level `amount`/`total`/`phoneVerified` is a hard reject

function bad(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const limit = checkRateLimit("order_ip", clientIp(request));
  if (!limit.ok) return rateLimitResponse(limit);

  // 1. Proof of phone, before anything else. No token, no order.
  const verified = readVerifiedPhoneFromRequest(request);
  if (!verified) {
    return bad(
      "Please verify your phone number before ordering. · 下單前請先驗證電話號碼。",
      401,
    );
  }

  // 2. Parse + validate shape.
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return bad("Your order could not be read. Please rebuild your cart. · 無法讀取訂單，請重新下單。");
  }

  // 3. The submitted number must be the verified one. Compared in E.164 so
  //    "(619) 555-0148" and "6195550148" cannot look like different numbers.
  const submitted = normalizePhone(body.pickup.phone);
  if (!submitted.ok || submitted.e164 !== verified.e164) {
    return bad(
      "That phone number doesn't match the one you verified. · 電話號碼與已驗證的號碼不符。",
      403,
    );
  }
  const phoneE164 = verified.e164;

  const tenant = publicTenant();
  const caps = orderCaps();

  // Tax must be configured before we can quote a total (never guess a rate).
  if (tenant.taxRateBps == null) {
    console.error("[orders] tax rate is not configured (TENANT_TAX_RATE_BPS)");
    return bad("Online ordering is temporarily unavailable. · 網上訂餐暫時無法使用。", 503);
  }

  const pickupOpts: PickupOptions = {
    timezone: tenant.timezone,
    leadMinutes: tenant.pickupLeadMinutes,
    intervalMinutes: tenant.pickupSlotIntervalMinutes,
  };
  const now = new Date();

  // 4. Validate pickup time against real, current store hours.
  if (body.pickup.time === "asap" && !isOpenNow(now, pickupOpts)) {
    return bad("We're closed right now — please choose a time when we're open. · 現時休息，請選擇營業時間。");
  }
  if (!isValidPickup(body.pickup.time, now, pickupOpts)) {
    return bad("That pickup time is no longer available. Please pick another. · 該取餐時間已不可選，請另選時間。");
  }

  const pickupAt = pickupInstant(
    body.pickup.time,
    tenant.timezone,
    tenant.pickupLeadMinutes,
    now,
  );

  // Upper bound on how far ahead an order may be placed. The slot generator
  // only offers times remaining today, so this is a backstop against a crafted
  // request rather than something a real customer can trip.
  const maxPickup = now.getTime() + caps.maxPickupHours * 60 * 60_000;
  if (pickupAt.getTime() > maxPickup) {
    return bad(
      `Pickup can only be scheduled up to ${caps.maxPickupHours} hours ahead. · 取餐時間最多只能提前 ${caps.maxPickupHours} 小時預訂。`,
    );
  }

  const businessDate = businessDateFor(tenant.timezone, now);

  // 5. Per-phone daily cap, counted in the database so it survives a lambda
  //    boundary. This is the ceiling on what one verified number can cost the
  //    kitchen in a day.
  try {
    const placed = await countOrdersForPhone(
      tenant.tenantId,
      businessDate,
      phoneE164,
    );
    if (placed >= caps.ordersPerPhonePerDay) {
      return bad(
        `You've reached today's order limit for this phone number. Please call us at ${phonesSentence}. · 此電話號碼已達今日訂單上限，請致電我們。`,
        429,
      );
    }
  } catch (err) {
    console.error(
      "[orders] could not check the per-phone cap:",
      err instanceof Error ? err.message : "unknown error",
    );
    return bad("We couldn't take your order just now. Please try again. · 目前無法接受訂單，請重試。", 503);
  }

  // 6. Recompute the order from the menu — the ONLY source of prices.
  const menu = await getMenu();
  const index = indexItems(menu);

  const resolvedLines: OrderLine[] = [];
  let subtotalCents = 0;
  for (const line of body.lines) {
    const item = index.get(line.itemId);
    if (!item) return bad("An item is no longer on the menu. Please rebuild your cart. · 有項目已下架，請重新下單。");
    if (!isAvailable(item)) return bad(`"${item.nameEn}" is currently unavailable. · 該項目暫時售罄。`);
    const size = itemSizes(item).find((s) => s.id === line.sizeId);
    if (!size) return bad(`A size is no longer available for "${item.nameEn}".`);

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
  if (totalCents <= 0) return bad("Your cart is empty. · 購物車是空的。");

  const timeLabel = pickupLabel(body.pickup.time, pickupOpts);

  // 7. Store it. The unique index on (tenant_id, idempotency_key) means a
  //    double-tap yields one order and one ticket, not two.
  let result;
  try {
    result = await createOrder({
      tenantId: tenant.tenantId,
      businessDate,
      orderNumberPrefix: tenant.orderNumberPrefix,
      idempotencyKey: body.idempotencyKey,
      items: resolvedLines,
      totals: {
        subtotalCents,
        taxCents: tax,
        // Payment happens at the counter, so tipping is the register's job.
        tipCents: 0,
        totalCents,
      },
      customer: { name: body.pickup.name, phone: phoneE164 },
      phoneVerifiedAt: new Date(verified.verifiedAt),
      pickupAt,
    });
  } catch (err) {
    console.error(
      "[orders] could not store the order:",
      err instanceof Error ? err.message : "unknown error",
    );
    return bad("We couldn't take your order just now. Please try again. · 目前無法接受訂單，請重試。", 503);
  }

  // 8. Confirm. A replayed idempotency key returns the ORIGINAL order number,
  //    so a customer who double-taps sees one order, not a second one.
  return Response.json({
    ok: true,
    orderNumber: result.order.orderNumber,
    total: result.order.totals.totalCents,
    pickupTime: timeLabel,
    duplicate: !result.created,
  });
}
