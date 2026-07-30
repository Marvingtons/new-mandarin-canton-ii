import { z } from "zod";
import { normalizePhone } from "@/lib/phone";
import { readRememberedPhoneFromRequest } from "@/lib/otp/session";
import { verifiedPhoneTtlDays } from "@/config/tenant.server";
import { checkRateLimit, rateLimitResponse } from "@/lib/http/rateLimit";
import { clientIp } from "@/lib/http/clientIp";

/**
 * POST /api/otp/status — "has this browser already proved this number?"
 *
 * The remember cookie is httpOnly, so the checkout cannot read it and cannot
 * decide this for itself. It asks, and the server compares.
 *
 * The answer is a BOOLEAN about a number the caller already supplied. It never
 * reveals which number is remembered, so this cannot be used to read a phone
 * number out of a browser someone else left logged in — the most it confirms is
 * a guess the asker already made.
 *
 * PRESENTATION ONLY. A true here just lets the checkout show its verified state
 * without a round of SMS; /api/orders re-checks the same cookie itself and is
 * the actual gate.
 */
export const runtime = "nodejs";

const BodySchema = z.object({ phone: z.string().min(1).max(32) }).strict();

export async function POST(request: Request): Promise<Response> {
  const limit = checkRateLimit("otp_check_ip", clientIp(request));
  if (!limit.ok) return rateLimitResponse(limit);

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return Response.json({ ok: true, verified: false });
  }

  const phone = normalizePhone(body.phone);
  if (!phone.ok || !phone.e164) return Response.json({ ok: true, verified: false });

  const remembered = readRememberedPhoneFromRequest(request, verifiedPhoneTtlDays());
  return Response.json({
    ok: true,
    verified: remembered !== null && remembered.e164 === phone.e164,
  });
}
