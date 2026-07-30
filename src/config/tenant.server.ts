import "server-only";

import { restaurant } from "@/data/restaurant";
import type {
  DayKey,
  OrderingWindow,
  PublicTenantConfig,
} from "@/config/tenant.types";

/**
 * The single place every tenant-specific value is resolved from env.
 *
 * `import "server-only"` above is load-bearing: if any client component ever
 * imports this module (directly or transitively), the BUILD FAILS instead of
 * silently shipping `undefined` — or, worse, a secret — to the browser.
 *
 * Reading env is deliberately LENIENT: a missing Twilio or printer credential
 * must not crash the marketing site. Values required for a specific integration are
 * validated at the point of use via the require* helpers below, which throw a
 * loud, actionable error naming the missing variable.
 *
 * Nothing in here is hardcoded to New Mandarin Canton — a second restaurant is
 * a new env set, not a code change.
 */

const DAYS: DayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

function env(name: string): string | null {
  const v = process.env[name];
  return v === undefined || v === "" ? null : v;
}

function intEnv(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Throws a clear, actionable error naming the env var that is missing. */
function required(name: string, why: string): string {
  const v = env(name);
  if (v === null) {
    throw new Error(
      `Missing required environment variable ${name}. ${why} See .env.example.`,
    );
  }
  return v;
}

/* ---------------------------------------------------------------- hours -- */

/** "9:00 PM" -> 1260 (minutes past midnight). Returns null if unparseable. */
function parse12h(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t.trim());
  if (!m) return null;
  let h = Number.parseInt(m[1], 10) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h * 60 + Number.parseInt(m[2], 10);
}

/** 1260 -> "21:00" */
function toHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Online-ordering hours.
 *
 * Preferred source is ONLINE_ORDERING_HOURS (JSON, 24h times). When unset we
 * derive the window from the confirmed dine-in hours in restaurant.ts minus a
 * closing cutoff, so online orders stop before the kitchen does.
 *
 * ⚠️ CONFIRM: ONLINE_ORDERING_CUTOFF_MINUTES defaults to 30 only because the
 * build spec proposed it. The owner must confirm the real cutoff.
 */
function resolveOrderingHours(): Record<DayKey, OrderingWindow> {
  const raw = env("ONLINE_ORDERING_HOURS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<DayKey, OrderingWindow>;
      // Trust but verify: every day must be present and well-formed.
      const ok = DAYS.every((d) => {
        const w = parsed[d];
        return (
          w && (w.closed === true || (typeof w.open === "string" && typeof w.close === "string"))
        );
      });
      if (ok) return parsed;
      console.warn(
        "[tenant] ONLINE_ORDERING_HOURS is missing days or malformed — falling back to dine-in hours minus cutoff.",
      );
    } catch {
      console.warn(
        "[tenant] ONLINE_ORDERING_HOURS is not valid JSON — falling back to dine-in hours minus cutoff.",
      );
    }
  }

  const cutoff = intEnv("ONLINE_ORDERING_CUTOFF_MINUTES", 30);
  const out = {} as Record<DayKey, OrderingWindow>;
  for (const day of DAYS) {
    const h = restaurant.hours[day];
    const open = parse12h(h.open);
    const close = parse12h(h.close);
    if (h.closed || open === null || close === null || close - cutoff <= open) {
      out[day] = { open: "00:00", close: "00:00", closed: true };
    } else {
      out[day] = { open: toHHMM(open), close: toHHMM(close - cutoff) };
    }
  }
  return out;
}

/**
 * Resolve the tax rate to integer basis points from either
 * TENANT_TAX_RATE_BPS (preferred, e.g. "775") or TAX_RATE (a decimal like
 * "0.0775"). Returns null when neither is set, which makes checkout refuse
 * to charge rather than guess a rate.
 */
function resolveTaxRateBps(bpsRaw: string | null): number | null {
  if (bpsRaw !== null) {
    const bps = Number.parseInt(bpsRaw, 10);
    return Number.isFinite(bps) ? bps : null;
  }
  const rateRaw = env("TAX_RATE");
  if (rateRaw === null) return null;
  const rate = Number.parseFloat(rateRaw);
  if (!Number.isFinite(rate) || rate < 0) return null;
  // 0.0775 -> 775 bps. Round to avoid float dust (0.0775 * 10000 = 774.999…).
  return Math.round(rate * 10000);
}

/* ------------------------------------------------------------- public ---- */

/**
 * The client-safe slice of tenant config. Server components call this and pass
 * the result to client components as props — never import tenant.server.ts
 * from a client component.
 */
export function publicTenant(): PublicTenantConfig {
  const taxRaw = env("TENANT_TAX_RATE_BPS");
  const tipsRaw = env("TIP_PRESETS");

  return {
    tenantId: env("TENANT_ID") ?? "new-mandarin-canton",
    // RESTAURANT_TIMEZONE is the documented name; TENANT_TIMEZONE is accepted
    // as the pre-existing alias so an already-configured deploy keeps working.
    timezone:
      env("RESTAURANT_TIMEZONE") ?? env("TENANT_TIMEZONE") ?? "America/Los_Angeles",
    // ⚠️ TODO(confirm): the real Chula Vista rate. Nothing is charged online
    // any more, but this figure prints on the kitchen ticket and is what the
    // customer is quoted, so a wrong value is still a wrong promise. Null
    // makes the order flow refuse rather than guess.
    // Preferred form is TENANT_TAX_RATE_BPS (exact integer basis points);
    // TAX_RATE (a decimal like 0.0775) is accepted as a fallback.
    taxRateBps: resolveTaxRateBps(taxRaw),
    // Empty array = tips not offered. Payment happens at the counter now, so
    // tipping is the register's business, not ours. Retained for tenant #2.
    tipPresets: tipsRaw
      ? tipsRaw
          .split(",")
          .map((s) => Number.parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n) && n >= 0 && n <= 100)
      : [],
    orderNumberPrefix: env("ORDER_NUMBER_PREFIX") ?? "A",
    pickupLeadMinutes: intEnv("PICKUP_LEAD_MINUTES", 20),
    pickupSlotIntervalMinutes: intEnv("PICKUP_SLOT_INTERVAL_MINUTES", 15),
    orderingHours: resolveOrderingHours(),
  };
}

/* --------------------------------------------------------------- caps ---- */

/**
 * Abuse ceilings. With no card on file, a verified phone number is the only
 * cost an abuser pays, so these are what stop one number ordering fifty
 * party trays for a kitchen that has already started cooking.
 */
export interface OrderCaps {
  /** Distinct orders one phone number may place per business day. */
  ordersPerPhonePerDay: number;
  /** How far ahead a pickup may be scheduled. */
  maxPickupHours: number;
}

export function orderCaps(): OrderCaps {
  return {
    // ⚠️ TODO(confirm): 5/day is a guess that should be generous enough for a
    // family ordering twice and tight enough to blunt a prank run.
    ordersPerPhonePerDay: intEnv("MAX_ORDERS_PER_PHONE_PER_DAY", 5),
    maxPickupHours: intEnv("MAX_PICKUP_HOURS", 48),
  };
}

/* ------------------------------------------------------------- secrets --- */

/**
 * Server-only credentials. Every one of these is read through `required()` at
 * the point of use, so a missing value is a loud, named error rather than a
 * silent `undefined` — and never a partially working integration.
 *
 * NOTHING here may be added to PublicTenantConfig. That object is serialized
 * into the page.
 */

/** Shared password for the /kitchen board. */
export function requireAdminPassword(): string {
  return required(
    "ADMIN_DASH_PASSWORD",
    "It gates the /kitchen staff board.",
  );
}

/**
 * HMAC key for the phone-verification cookie.
 *
 * Its OWN secret, not the kitchen password. The two have nothing in common
 * beyond both being secrets: one is read aloud across a kitchen and rotated
 * whenever staff change, the other signs the token that proves a customer
 * holds their phone. Sharing them meant a routine password rotation silently
 * invalidated every in-flight verification.
 *
 * Deliberately no fallback to ADMIN_DASH_PASSWORD. A fallback would quietly
 * rebuild the coupling on any deploy that forgot this variable, and a signing
 * key that is sometimes one thing and sometimes another is worse than one that
 * is missing loudly.
 */
export function requireOtpSigningSecret(): string {
  return required(
    "OTP_SIGNING_SECRET",
    "It signs the phone-verification cookie. Generate with: openssl rand -hex 32",
  );
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  verifyServiceSid: string;
  /** Sending number or Messaging Service SID for outbound SMS. */
  messagingFrom: string | null;
}

/**
 * Twilio credentials, or null when SMS is not configured.
 *
 * Read leniently on purpose: OTP is required to place an order, but the
 * marketing site, the menu, and the kitchen board must all boot without it.
 * Callers that genuinely cannot proceed surface a clean "unavailable" state.
 */
export function twilioConfig(): TwilioConfig | null {
  const accountSid = env("TWILIO_ACCOUNT_SID");
  const authToken = env("TWILIO_AUTH_TOKEN");
  const verifyServiceSid = env("TWILIO_VERIFY_SERVICE_SID");
  if (!accountSid || !authToken || !verifyServiceSid) return null;
  return {
    accountSid,
    authToken,
    verifyServiceSid,
    messagingFrom: env("TWILIO_MESSAGING_FROM"),
  };
}

/** True when outbound SMS (order-ready, owner alerts) can actually be sent. */
export function isSmsConfigured(): boolean {
  const config = twilioConfig();
  return config !== null && config.messagingFrom !== null;
}

/** Owner's number for unprinted-order alerts. Null disables the alert. */
export function ownerAlertPhone(): string | null {
  return env("OWNER_ALERT_PHONE");
}

/** Secret path segment the CloudPRNT printer polls. */
export function requireCloudPrntSecret(): string {
  return required(
    "CLOUDPRNT_SECRET",
    "It is the unguessable path segment the printer polls; generate a long random value.",
  );
}

/** Expected printer MAC/serial, when pinned. Null = accept any printer. */
export function cloudPrntPrinterMac(): string | null {
  return env("CLOUDPRNT_PRINTER_MAC");
}

/**
 * How to drive the audible alert on the printer. See lib/print/cloudprnt.ts
 * for why this is a mode rather than a boolean — the correct header depends on
 * whether the buzzer is wired to the cash-drawer port or is a dedicated one.
 *
 *   off (default) | drawer | buzzer | both
 *
 * "1"/"true" are accepted as aliases for "drawer", because a buzzer on the DK
 * port is the setup this was built for.
 */
export type BuzzerMode = "off" | "drawer" | "buzzer" | "both";

export function cloudPrntBuzzerMode(): BuzzerMode {
  const value = env("CLOUDPRNT_BUZZER")?.toLowerCase();
  if (value === "1" || value === "true" || value === "drawer") return "drawer";
  if (value === "buzzer") return "buzzer";
  if (value === "both") return "both";
  return "off";
}

/** Secret guarding the Vercel cron endpoint. */
export function cronSecret(): string | null {
  return env("CRON_SECRET");
}

/**
 * Key that lets a request skip the ORDER TIME gates. See lib/order/bypass.ts.
 *
 * Read leniently, and unset is the normal production state: no value means no
 * bypass exists at all, which is the only configuration a customer should ever
 * meet. This is a testing affordance, not a feature.
 */
export function orderGateBypassSecret(): string | null {
  return env("ORDER_GATE_BYPASS");
}
