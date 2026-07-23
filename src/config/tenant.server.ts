import "server-only";

import { restaurant } from "@/data/restaurant";
import type {
  CloverEnv,
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
 * Reading env is deliberately LENIENT: a missing Clover token must not crash
 * the marketing site. Values that are required for a specific integration are
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
    timezone: env("TENANT_TIMEZONE") ?? "America/Los_Angeles",
    // ⚠️ CONFIRM: null until the real Chula Vista rate is supplied. Checkout
    // refuses to charge while this is null rather than guessing a tax rate.
    // Preferred form is TENANT_TAX_RATE_BPS (exact integer basis points);
    // TAX_RATE (a decimal like 0.0775) is accepted as a fallback and
    // converted to bps.
    taxRateBps: resolveTaxRateBps(taxRaw),
    // Empty array = tips not offered. ⚠️ CONFIRM whether pickup takes tips.
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

/* ------------------------------------------------------------- secrets --- */

export function cloverEnv(): CloverEnv {
  return env("CLOVER_ENV") === "production" ? "production" : "sandbox";
}

/** Merchant id (MID). Not secret, but server-resolved for consistency. */
export function requireMerchantId(): string {
  return required(
    "CLOVER_MERCHANT_ID",
    "It identifies which Clover merchant to read the menu for.",
  );
}

/**
 * Merchant id without throwing — for the checkout page, which must render a
 * graceful "payment unavailable" state (not crash) when creds aren't set yet.
 * The MID is not secret; the iframe needs it on the client.
 */
export function cloverMerchantId(): string | null {
  return env("CLOVER_MERCHANT_ID");
}

/**
 * Public ecommerce token (PAKMS / apiAccessKey) for the browser iframe. Read
 * leniently: an empty value makes the payment form show a clear "unavailable"
 * message plus a tel: fallback rather than crashing.
 */
export function cloverPublicToken(): string | null {
  return env("NEXT_PUBLIC_CLOVER_PUBLIC_TOKEN");
}

/** Clover hosted-iframe SDK URL for the active environment. */
export function cloverSdkUrl(): string {
  return cloverEnv() === "production"
    ? "https://checkout.clover.com/sdk.js"
    : "https://checkout.sandbox.dev.clover.com/sdk.js";
}

/**
 * Dashboard API token with INVENTORY_R, used ONLY to read the menu.
 * This is NOT the ecommerce sk_ key — Clover's ecommerce tokens cannot read
 * v3 inventory. See README-OPERATIONS.md.
 */
export function requireInventoryToken(): string {
  return required(
    "CLOVER_INVENTORY_TOKEN",
    "Create it in the Clover Dashboard under API Tokens with the Inventory:Read permission.",
  );
}

/** Ecommerce private token used ONLY server-side to create charges. */
export function requirePrivateToken(): string {
  return required(
    "CLOVER_PRIVATE_TOKEN",
    "This is the ecommerce secret key used to POST /v1/charges. It must never reach the client.",
  );
}

export function requireRevalidateSecret(): string {
  return required(
    "REVALIDATE_SECRET",
    "It guards POST /api/revalidate-menu against unauthenticated cache busting.",
  );
}

export function supabaseConfig(): { url: string; serviceRoleKey: string } {
  return {
    url: required("SUPABASE_URL", "Supabase project URL for the order store."),
    serviceRoleKey: required(
      "SUPABASE_SERVICE_ROLE_KEY",
      "Server-only Supabase key. It bypasses RLS and must never reach the client.",
    ),
  };
}
