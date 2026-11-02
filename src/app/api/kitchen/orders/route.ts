import { orderCaps, publicTenant } from "@/config/tenant.server";
import {
  hasKitchenSessionFromRequest,
  kitchenSessionKey,
} from "@/lib/auth/kitchenSession";
import { businessDateFor, pickupInstant } from "@/lib/orders/businessDate";
import { isOrdersDbConfigured } from "@/lib/db/postgres";
import { createOrder, listActiveOrders } from "@/lib/orders/repository";
import { getMenu } from "@/lib/menu/source";
import { composeOrder, staffLunchAllowed } from "@/lib/orders/compose";
import {
  StaffOrderRequestSchema,
  type StaffOrderRequest,
} from "@/lib/orders/requestSchema";
import { isValidStaffPickup, type PickupOptions } from "@/lib/order/pickup";
import { isGateBypassRequest, isWellFormedPickupValue } from "@/lib/order/bypass";
import { readyWindow } from "@/lib/order/readyWindow";
import { normalizePhone } from "@/lib/phone";
import { checkRateLimit, rateLimitResponse } from "@/lib/http/rateLimit";
import { readPrinterStatus } from "@/lib/print/healthStore";
import { derivePrinterHealth, type PrinterHealth } from "@/lib/print/printerStatus";
import { cloudPrntConfigured } from "@/lib/print/status";

/** Printer health as the board renders it. Recomputed on every poll. */
export interface PrinterHealthPayload {
  health: PrinterHealth;
  /** Whole seconds since the last poll, or null if it has never polled. */
  secondsSinceSeen: number | null;
  /** The printer's own words, for the operator who wants the detail. */
  statusCode: string | null;
  /** True while jobs are being withheld — the board says "waiting", not "stuck". */
  blocked: boolean;
  /** False when no printer is configured at all; the strip then stays quiet. */
  configured: boolean;
}

/**
 * Health, derived fresh on every board poll.
 *
 * Derived rather than stored, because "offline" is not something a printer
 * ever tells us — it is the absence of it telling us anything, and that can
 * only be computed against the clock at read time. A stored `online` column
 * would be permanently one poll behind and would read "OK" forever after a
 * power cut.
 */
async function printerHealth(tenantId: string): Promise<PrinterHealthPayload> {
  const configured = cloudPrntConfigured();
  const row = await readPrinterStatus(tenantId);
  if (!row) {
    return {
      health: "unknown",
      secondsSinceSeen: null,
      statusCode: null,
      blocked: false,
      configured,
    };
  }

  const secondsSinceSeen = Math.max(
    0,
    Math.round((Date.now() - Date.parse(row.lastSeenAt)) / 1000),
  );
  const health = derivePrinterHealth({
    secondsSinceSeen,
    paperOut: row.paperOut,
    coverOpen: row.coverOpen,
  });

  return {
    health,
    secondsSinceSeen,
    statusCode: row.statusCode,
    // Exactly the states in which the poll route is withholding work. Offline
    // is included even though nothing is being withheld deliberately — from a
    // queued order's point of view the outcome is identical, and the board's
    // job is to say why nothing is printing.
    blocked: health === "paper-out" || health === "cover-open" || health === "offline",
    configured,
  };
}

/**
 * GET /api/kitchen/orders — the board's polling endpoint.
 *
 * Deliberately NOT rate limited: the board polls every 10s by design, and
 * throttling it would blind the kitchen exactly when the restaurant is busy
 * enough to have several tablets open.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!hasKitchenSessionFromRequest(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const tenant = publicTenant();

  if (!isOrdersDbConfigured()) {
    // A missing DATABASE_URL is an operator problem. Say so plainly on the
    // board rather than rendering an empty queue, which reads as "no orders".
    return Response.json({
      ok: false,
      error: "The order database is not configured (DATABASE_URL).",
      orders: [],
    });
  }

  const url = new URL(request.url);
  const includeCompleted = url.searchParams.get("completed") === "1";
  const businessDate =
    url.searchParams.get("date") ?? businessDateFor(tenant.timezone);

  try {
    // Both in one round trip — the board asks the same question ten seconds
    // later, and a health strip that lagged the queue by a poll would tell the
    // kitchen the printer was fine while the orders under it said otherwise.
    const [orders, printer] = await Promise.all([
      listActiveOrders(tenant.tenantId, businessDate, { includeCompleted }),
      printerHealth(tenant.tenantId),
    ]);
    return Response.json(
      { ok: true, orders, businessDate, printer },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error(
      "[kitchen] order list failed:",
      err instanceof Error ? err.message : "unknown error",
    );
    return Response.json(
      { ok: false, error: "Could not load orders.", orders: [] },
      { status: 503 },
    );
  }
}

/**
 * Machine-readable refusals, so the POS can show them in the staff member's
 * chosen language. The prose beside each is the bilingual fallback.
 */
export type StaffOrderError =
  | "unauthorized"
  | "bad_request"
  | "phone_required"
  | "phone_invalid"
  | "pickup_invalid"
  | "item_unavailable"
  | "rejected"
  | "unavailable";

function refuse(code: StaffOrderError, message: string, status = 400): Response {
  return Response.json({ ok: false, code, error: message }, { status });
}

/**
 * POST /api/kitchen/orders: a phone or walk-in order from the staff POS.
 *
 * ONE PIPELINE. This is the web checkout minus the OTP, and nothing else:
 *
 *   - priced by the same composeOrder() against the same getMenu(), at the
 *     same TENANT_TAX_RATE_BPS, so the body carries no money and a body that
 *     tries is a hard 400 (the schema is .strict());
 *   - stored by the same createOrder(): the same daily A-xxx counter, the same
 *     idempotency index, status QUEUED;
 *   - printed by the same CloudPRNT claim. Nothing here talks to a printer.
 *
 * What staff may do that the web may not: pick a pickup time after the online
 * cutoff (but inside store hours), and order a lunch special outside 11 to 3
 * with the override toggle. Both are the counter's call to make.
 *
 * Not subject to the web's per-phone daily cap, and does not count toward it
 * (countOrdersForPhone counts channel 'web' only): that cap is abuse control
 * for anonymous OTP ordering, and staff on the phone are the verification.
 *
 * Payment is always PAY AT COUNTER. `paymentNote` records what happened on the
 * Clover terminal in words; there is no card field and never will be.
 */
export async function POST(request: Request): Promise<Response> {
  const sessionKey = kitchenSessionKey(request);
  if (!sessionKey) return refuse("unauthorized", "unauthorized", 401);

  const limit = checkRateLimit("kitchen_order_session", sessionKey);
  if (!limit.ok) return rateLimitResponse(limit);

  if (!isOrdersDbConfigured()) {
    return refuse("unavailable", "The order database is not configured (DATABASE_URL).", 503);
  }

  let body: StaffOrderRequest;
  try {
    body = StaffOrderRequestSchema.parse(await request.json());
  } catch {
    return refuse("bad_request", "The order could not be read. · 無法讀取訂單。");
  }

  const tenant = publicTenant();
  if (tenant.taxRateBps == null) {
    console.error("[kitchen-orders] tax rate is not configured (TENANT_TAX_RATE_BPS)");
    return refuse("unavailable", "Tax rate is not configured. · 稅率未設定。", 503);
  }

  // The customer. A phone order must have a callable number; a walk-in may
  // leave it blank, but anything typed must still be a real number.
  const rawPhone = (body.customer.phone ?? "").trim();
  let phoneE164 = "";
  if (rawPhone) {
    const normalized = normalizePhone(rawPhone);
    if (!normalized.ok || !normalized.e164) {
      return refuse("phone_invalid", "That phone number is not valid. · 電話號碼無效。");
    }
    phoneE164 = normalized.e164;
  } else if (body.channel === "phone") {
    return refuse("phone_required", "A phone order needs a phone number. · 電話訂單需要電話號碼。");
  }

  const pickupOpts: PickupOptions = {
    timezone: tenant.timezone,
    leadMinutes: tenant.pickupLeadMinutes,
    intervalMinutes: tenant.pickupSlotIntervalMinutes,
  };
  const now = new Date();
  // The same test-mode signal the web honours, for exercising the POS out of
  // hours. Skips the clocks only: store hours and the lunch window.
  const bypass = isGateBypassRequest(request);

  const pickupOk = bypass
    ? isWellFormedPickupValue(body.pickup.time)
    : isValidStaffPickup(body.pickup.time, now, pickupOpts);
  if (!pickupOk) {
    return refuse(
      "pickup_invalid",
      "That pickup time is outside store hours. · 取餐時間不在營業時間內。",
    );
  }

  const composed = composeOrder(await getMenu(), body.lines, {
    taxRateBps: tenant.taxRateBps,
    lunchAllowed: staffLunchAllowed({
      now,
      opts: pickupOpts,
      override: body.lunchOverride === true,
      bypass,
    }),
  });
  if (!composed.ok) {
    return refuse(composed.reason === "item_unavailable" ? "item_unavailable" : "rejected", composed.error);
  }

  const pickupAt = pickupInstant(body.pickup.time, tenant.timezone, tenant.pickupLeadMinutes, now);
  const maxPickup = now.getTime() + orderCaps().maxPickupHours * 60 * 60_000;
  if (pickupAt.getTime() > maxPickup) {
    return refuse("pickup_invalid", "That pickup time is too far ahead. · 取餐時間太遠。");
  }

  const ready = readyWindow(
    now,
    pickupOpts,
    composed.hasLongPrep,
    body.pickup.time === "asap" ? null : pickupAt,
  );

  const clean = (value: string | undefined) => {
    const trimmed = (value ?? "").trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  try {
    const result = await createOrder({
      tenantId: tenant.tenantId,
      businessDate: businessDateFor(tenant.timezone, now),
      orderNumberPrefix: tenant.orderNumberPrefix,
      idempotencyKey: `pos:${body.idempotencyKey}`,
      items: composed.lines,
      totals: composed.totals,
      customer: { name: body.customer.name.trim(), phone: phoneE164 },
      // Staff taking the order IS the verification; see migration 009.
      phoneVerifiedAt: now,
      pickupAt: ready.from,
      readyFrom: ready.from,
      readyTo: ready.to,
      channel: body.channel,
      paymentNote: clean(body.paymentNote),
      staffNote: clean(body.staffNote),
    });
    if (bypass) {
      console.warn(
        `[kitchen-orders] *** GATE BYPASSED *** staff order ${result.order.orderNumber}: ` +
          "store-hours and lunch-window gates were SKIPPED (test mode).",
      );
    }
    return Response.json({
      ok: true,
      order: {
        id: result.order.id,
        orderNumber: result.order.orderNumber,
        totalCents: result.order.totals.totalCents,
        channel: result.order.channel,
      },
      duplicate: !result.created,
    });
  } catch (err) {
    console.error(
      "[kitchen-orders] could not store the order:",
      err instanceof Error ? err.message : "unknown error",
    );
    return refuse("unavailable", "Could not save the order. Please try again. · 無法儲存訂單，請重試。", 503);
  }
}
