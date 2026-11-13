import { phonesSentence } from "@/data/restaurant";
import { z } from "zod";
import { normalizePhone, phoneErrorMessage, phoneLast4 } from "@/lib/phone";
import { startVerification, type OtpStartResult } from "@/lib/otp/twilio";
import { claimOtpStart, joinOtpStart } from "@/lib/otp/startClaim";
import { checkRateLimit, rateLimitResponse } from "@/lib/http/rateLimit";
import { clientIp } from "@/lib/http/clientIp";
import { twilioConfig } from "@/config/tenant.server";
import { previewOrderingBlocked } from "@/lib/http/deployHost";

/**
 * POST /api/otp/start — send an SMS verification code.
 *
 * EVERY REQUEST PAST THE GUARDS COSTS MONEY. So the order of operations here
 * is deliberate and should not be rearranged:
 *
 *   1. IP limit      — cheapest check, catches a naive loop
 *   2. parse         — free
 *   3. normalize     — free, and rejects toll-free/malformed before spending
 *   4. claim         — a start already in flight (or sent in the last 30 s)
 *                      for this number answers this one; see lib/otp/startClaim
 *   5. phone limits  — burst AND a hard daily ceiling for this number
 *   6. Twilio        — the only step that bills
 *
 * The response never reveals whether a number is already known to us.
 */
export const runtime = "nodejs";

const BodySchema = z.strictObject({ phone: z.string().min(1).max(32) });

export async function POST(request: Request): Promise<Response> {
  // Not on a preview: this sends a real text on the production Twilio
  // account. See lib/http/deployHost.
  const blocked = previewOrderingBlocked(request);
  if (blocked) return blocked;

  const ip = clientIp(request);

  const ipLimit = checkRateLimit("otp_start_ip", ip);
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return Response.json(
      { ok: false, error: "Please enter your phone number. · 請輸入電話號碼。" },
      { status: 400 },
    );
  }

  // Free rejection of shapes that can never receive a customer's code.
  const phone = normalizePhone(body.phone);
  if (!phone.ok || !phone.e164) {
    return Response.json(
      { ok: false, error: phoneErrorMessage(phone.error ?? "invalid_exchange") },
      { status: 400 },
    );
  }

  // Configuration check before the per-number budget is spent: refusing for a
  // reason the customer cannot fix should not also burn their daily quota.
  if (!twilioConfig()) {
    console.error("[otp] Twilio is not configured (TWILIO_* env vars)");
    return Response.json(
      {
        ok: false,
        error:
          `Online ordering is temporarily unavailable. Please call us at ${phonesSentence}. · 網上訂餐暫時無法使用，請致電我們。`,
      },
      { status: 503 },
    );
  }

  // A duplicate of a start already claimed for this number gets that start's
  // response and costs nothing (not even phone quota). No await between this
  // check and claimOtpStart below, so two requests cannot both get past it.
  const claimed = joinOtpStart(phone.e164);
  if (claimed) return startResponse(await claimed, phone.e164);

  const burst = checkRateLimit("otp_start_phone", phone.e164);
  if (!burst.ok) return rateLimitResponse(burst);

  const daily = checkRateLimit("otp_start_phone_daily", phone.e164);
  if (!daily.ok) return rateLimitResponse(daily);

  const e164 = phone.e164;
  return startResponse(await claimOtpStart(e164, () => startVerification(e164)), e164);
}

function startResponse(result: OtpStartResult, phoneE164: string): Response {
  if (result.status === "disabled") {
    return Response.json(
      {
        ok: false,
        error:
          `Online ordering is temporarily unavailable. Please call us at ${phonesSentence}. · 網上訂餐暫時無法使用，請致電我們。`,
      },
      { status: 503 },
    );
  }
  if (result.status === "error") {
    return Response.json(
      { ok: false, error: result.error },
      { status: result.retryable ? 503 : 400 },
    );
  }

  // Echo only the last four digits — enough for the customer to spot a typo,
  // not enough to confirm a number to someone probing.
  return Response.json({ ok: true, last4: phoneLast4(phoneE164) });
}
