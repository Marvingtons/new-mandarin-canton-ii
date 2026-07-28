import "server-only";

import { twilioConfig } from "@/config/tenant.server";

/**
 * Twilio Verify + Messaging, over plain fetch.
 *
 * No SDK on purpose: we use three endpoints, the SDK is a large dependency in
 * a serverless bundle, and the auth is HTTP Basic. The whole surface is below.
 *
 * SECURITY: the account SID and auth token are read here and attached to a
 * header. They are never logged, never interpolated into a URL we log, and
 * never attached to a thrown error — a reflexive `console.error(err)` upstream
 * must not be able to serialize them.
 */

const VERIFY_BASE = "https://verify.twilio.com/v2";
const API_BASE = "https://api.twilio.com/2010-04-01";

export type OtpStartResult =
  | { status: "sent" }
  | { status: "disabled"; reason: string }
  | { status: "error"; error: string; retryable: boolean };

export type OtpCheckResult =
  | { status: "approved" }
  | { status: "rejected" }
  | { status: "expired" }
  | { status: "disabled"; reason: string }
  | { status: "error"; error: string };

function basicAuth(sid: string, token: string): string {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
}

/**
 * Twilio's REST API returns a numeric `code` on errors. The handful we care
 * about, because each one means something different to the customer:
 *   20404 — verification not found (expired or already used)
 *   60200 — invalid parameter (usually a malformed number)
 *   60202 — max check attempts reached
 *   60203 — max send attempts reached for this number
 *   60205 — SMS is not supported by this landline
 *   60212 — too many concurrent requests for this number
 */
interface TwilioError {
  code?: number;
  message?: string;
  status?: number;
}

/** Start an SMS verification. Never throws — callers render the outcome. */
export async function startVerification(
  phoneE164: string,
): Promise<OtpStartResult> {
  const config = twilioConfig();
  if (!config) {
    return { status: "disabled", reason: "Twilio is not configured" };
  }

  try {
    const response = await fetch(
      `${VERIFY_BASE}/Services/${config.verifyServiceSid}/Verifications`,
      {
        method: "POST",
        headers: {
          Authorization: basicAuth(config.accountSid, config.authToken),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: phoneE164, Channel: "sms" }),
        cache: "no-store",
      },
    );

    if (response.ok) return { status: "sent" };

    const payload = (await response.json().catch(() => ({}))) as TwilioError;
    // Log the code, never the number and never the credentials.
    console.warn(
      `[otp] verification start failed: twilio code ${payload.code ?? "?"} (http ${response.status})`,
    );

    if (payload.code === 60205) {
      return {
        status: "error",
        error: "That number can't receive texts. Please use a mobile number. · 該號碼無法接收簡訊，請使用手機號碼。",
        retryable: false,
      };
    }
    if (payload.code === 60203 || payload.code === 60212) {
      return {
        status: "error",
        error: "Too many codes requested for that number. Please wait a few minutes. · 該號碼要求驗證碼次數過多，請稍候幾分鐘。",
        retryable: false,
      };
    }
    if (payload.code === 60200) {
      return {
        status: "error",
        error: "That phone number isn't valid. · 電話號碼無效。",
        retryable: false,
      };
    }
    return {
      status: "error",
      error: "We couldn't send a code just now. Please try again. · 目前無法發送驗證碼，請重試。",
      retryable: response.status >= 500,
    };
  } catch {
    // A network-level throw can embed the request, including its auth header.
    console.warn("[otp] verification start: network error reaching Twilio");
    return {
      status: "error",
      error: "We couldn't send a code just now. Please try again. · 目前無法發送驗證碼，請重試。",
      retryable: true,
    };
  }
}

/** Check a submitted code. Never throws. */
export async function checkVerification(
  phoneE164: string,
  code: string,
): Promise<OtpCheckResult> {
  const config = twilioConfig();
  if (!config) {
    return { status: "disabled", reason: "Twilio is not configured" };
  }

  try {
    const response = await fetch(
      `${VERIFY_BASE}/Services/${config.verifyServiceSid}/VerificationCheck`,
      {
        method: "POST",
        headers: {
          Authorization: basicAuth(config.accountSid, config.authToken),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: phoneE164, Code: code }),
        cache: "no-store",
      },
    );

    if (response.ok) {
      const payload = (await response.json()) as { status?: string };
      return payload.status === "approved"
        ? { status: "approved" }
        : { status: "rejected" };
    }

    const payload = (await response.json().catch(() => ({}))) as TwilioError;
    console.warn(
      `[otp] verification check failed: twilio code ${payload.code ?? "?"} (http ${response.status})`,
    );

    // 20404 means the verification is gone: expired, or already consumed.
    if (payload.code === 20404) return { status: "expired" };
    if (payload.code === 60202) {
      return {
        status: "error",
        error: "Too many incorrect attempts. Please request a new code. · 錯誤次數過多，請重新索取驗證碼。",
      };
    }
    return {
      status: "error",
      error: "We couldn't check that code. Please try again. · 無法驗證此代碼，請重試。",
    };
  } catch {
    console.warn("[otp] verification check: network error reaching Twilio");
    return {
      status: "error",
      error: "We couldn't check that code. Please try again. · 無法驗證此代碼，請重試。",
    };
  }
}

/**
 * Send a plain SMS (order-ready notice, owner alert).
 *
 * Silently no-ops when messaging is unconfigured — an un-sent courtesy text
 * must never become an error the customer or the kitchen sees.
 */
export async function sendSms(
  toE164: string,
  body: string,
): Promise<{ sent: boolean; error?: string }> {
  const config = twilioConfig();
  if (!config || !config.messagingFrom) {
    return { sent: false, error: "messaging is not configured" };
  }

  // A Messaging Service SID (MG…) goes in a different field from a phone
  // number. Getting this wrong is a 400 from Twilio, so branch on the prefix.
  const from: Record<string, string> = config.messagingFrom.startsWith("MG")
    ? { MessagingServiceSid: config.messagingFrom }
    : { From: config.messagingFrom };

  try {
    const response = await fetch(
      `${API_BASE}/Accounts/${config.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: basicAuth(config.accountSid, config.authToken),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: toE164, Body: body, ...from }),
        cache: "no-store",
      },
    );

    if (response.ok) return { sent: true };

    const payload = (await response.json().catch(() => ({}))) as TwilioError;
    console.warn(`[sms] send failed: twilio code ${payload.code ?? "?"}`);
    return { sent: false, error: `twilio code ${payload.code ?? response.status}` };
  } catch {
    console.warn("[sms] send: network error reaching Twilio");
    return { sent: false, error: "network error" };
  }
}
