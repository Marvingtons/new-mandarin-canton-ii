import { phonesSentence } from "@/data/restaurant";
import { z } from "zod";
import { normalizePhone, phoneErrorMessage, phoneLast4 } from "@/lib/phone";
import { checkVerification } from "@/lib/otp/twilio";
import { setRememberCookie, setVerifiedCookie } from "@/lib/otp/session";
import { verifiedPhoneTtlDays } from "@/config/tenant.server";
import { checkRateLimit, rateLimitResponse } from "@/lib/http/rateLimit";
import { clientIp } from "@/lib/http/clientIp";

/**
 * POST /api/otp/check — verify the code and mint the proof-of-phone cookie.
 *
 * On success this sets an httpOnly cookie binding this browser session to this
 * phone number for 15 minutes. That cookie is what /api/orders requires; a
 * client-supplied "verified" flag is never trusted, and cannot be, because the
 * number the order is filed under is read back out of the signed token rather
 * than off the request body.
 *
 * Rate limited per number AND per IP: without a cap, a six-digit code is a
 * million guesses. Twilio enforces its own attempt ceiling too (error 60202),
 * so this is defense in depth rather than the only barrier.
 */
export const runtime = "nodejs";

const BodySchema = z
  .object({
    phone: z.string().min(1).max(32),
    // Twilio Verify codes are numeric; anything else is not worth an API call.
    code: z.string().regex(/^\d{4,10}$/, "code must be 4-10 digits"),
  })
  .strict();

function bad(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const ip = clientIp(request);

  const ipLimit = checkRateLimit("otp_check_ip", ip);
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return bad("Please enter the 6-digit code we texted you. · 請輸入我們發送的六位數驗證碼。");
  }

  const phone = normalizePhone(body.phone);
  if (!phone.ok || !phone.e164) {
    return bad(phoneErrorMessage(phone.error ?? "invalid_exchange"));
  }

  const phoneLimit = checkRateLimit("otp_check_phone", phone.e164);
  if (!phoneLimit.ok) return rateLimitResponse(phoneLimit);

  const result = await checkVerification(phone.e164, body.code);

  switch (result.status) {
    case "approved":
      await setVerifiedCookie(phone.e164);
      // Returning customers should not re-verify every visit. Separate cookie,
      // separate signature domain, separate lifetime — see session.ts.
      await setRememberCookie(phone.e164, verifiedPhoneTtlDays());
      return Response.json({ ok: true, last4: phoneLast4(phone.e164) });

    case "rejected":
      return bad("That code isn't right. Please check and try again. · 驗證碼不正確，請再試一次。");

    case "expired":
      return bad("That code has expired. Please request a new one. · 驗證碼已過期，請重新索取。");

    case "disabled":
      return bad(
        `Online ordering is temporarily unavailable. Please call us at ${phonesSentence}. · 網上訂餐暫時無法使用，請致電我們。`,
        503,
      );

    default:
      return bad(result.error, 503);
  }
}
