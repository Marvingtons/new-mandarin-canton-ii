import "server-only";

import { restaurant } from "@/data/restaurant";
import { defaultCopyRoles, parseCopyRoles } from "@/lib/ticket/copies";
import type { TicketCopyRole } from "@/lib/ticket/copies";
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
 * ⚠️ THIS WAS A SECOND SOURCE OF TRUTH FOR THE CUTOFF, and it disagreed.
 *
 * It used to compute `close − ONLINE_ORDERING_CUTOFF_MINUTES`, a flat 30
 * that defaulted from a build spec and was flagged for the owner. Meanwhile
 * restaurant.ts grew a real per-day `lastOnlineOrder`, which is what
 * lib/order/pickup.ts gates on and what every display surface prints. The
 * two have not matched since: this produced 8:00 PM where the site says
 * 8:30, and 8:30 where Saturday now says 9:00.
 *
 * Nothing gates on it today — `orderingStatus()` in lib/menu/onlineHours is
 * the only reader and has no callers — so the disagreement was latent
 * rather than live. It was still shipped to the browser inside the public
 * tenant object on every page, one call away from silently refusing orders
 * half an hour before the whole rest of the site says ordering stops.
 *
 * It reads `lastOnlineOrder` now, so the fallback cannot drift from the
 * gate. ONLINE_ORDERING_CUTOFF_MINUTES is gone with it: "how long before
 * close does the kitchen need" is a per-day decision the owner makes in
 * restaurant.ts, not a global integer, and its ⚠️ CONFIRM went with it.
 *
 * ONLINE_ORDERING_HOURS still overrides everything, for a deployment that
 * genuinely needs a window unlike the door hours. Setting it re-creates the
 * second source deliberately, which is the difference between an override
 * and a default.
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
        "[tenant] ONLINE_ORDERING_HOURS is missing days or malformed — falling back to the per-day cutoff in restaurant.ts.",
      );
    } catch {
      console.warn(
        "[tenant] ONLINE_ORDERING_HOURS is not valid JSON — falling back to the per-day cutoff in restaurant.ts.",
      );
    }
  }

  const out = {} as Record<DayKey, OrderingWindow>;
  for (const day of DAYS) {
    const h = restaurant.hours[day];
    const open = parse12h(h.open);
    const close = parse12h(h.close);
    // The configured cutoff, clamped into the door hours exactly as
    // pickup.ts's todaysWindow() clamps it — same rule, same result.
    const configured = parse12h(h.lastOnlineOrder);
    if (h.closed || open === null || close === null) {
      out[day] = { open: "00:00", close: "00:00", closed: true };
      continue;
    }
    const lastOrder =
      configured === null ? close : Math.min(Math.max(configured, open), close);
    out[day] =
      lastOrder <= open
        ? { open: "00:00", close: "00:00", closed: true }
        : { open: toHHMM(open), close: toHHMM(lastOrder) };
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
 * How long a browser stays "already verified" for a number it has proved.
 *
 * Caches VERIFICATION only. The per-phone daily cap, the rate limits and every
 * other control are counted in the database against the E.164 number and are
 * completely untouched by this — a remembered customer is capped exactly like
 * a freshly verified one.
 *
 * 0 turns the feature off: no cookie is set, and any already issued is refused.
 */
/**
 * Copies of each ticket in one print job, each cut from the last.
 *
 * Two by default: one stays with the cooks, one goes on the bag so whoever
 * hands the order over can check it without walking back to the line. The
 * restaurant runs three — kitchen, bag, register.
 */
export function ticketCopies(): number {
  const n = intEnv("TICKET_COPIES", 2);
  // Clamped: 0 would print nothing and a typo'd 50 would burn the roll.
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 5) : 2;
}

/**
 * WHICH copy each of those is, and therefore what it shows.
 *
 * The roles decide the render profile — the kitchen copy carries no prices at
 * all (see lib/ticket/copies.ts). Unset is the normal case: the default
 * sequence for the configured count is what the kitchen asked for. Set
 * TICKET_COPY_ROLES to a comma list ("kitchen,register,bag") to reorder, and
 * it is IGNORED unless it names exactly as many copies as TICKET_COPIES, so a
 * half-edited variable can never silently drop a ticket.
 */
export function ticketCopyRoles(): TicketCopyRole[] {
  const total = ticketCopies();
  return parseCopyRoles(env("TICKET_COPY_ROLES")) ?? defaultCopyRoles(total);
}

/* ------------------------------------------------------- print patience --- */

/**
 * HAND-OVERS of the same job before we stop offering it.
 *
 * ⚠️ THE UNIT CHANGED. This used to count POLLS, because every unconfirmed poll
 * could produce another hand-over, and the default was 40 ≈ two minutes at a
 * three-second poll interval. A poll can no longer produce a hand-over inside
 * the confirmation window (see lib/print/entitlement.ts), so this now counts
 * what it always claimed to: actual deliveries of paper.
 *
 * Four, not forty. Each retry is now separated by a full confirmation window —
 * 90s for the configured three copies — so four hand-overs is about four and a
 * half minutes of trying, which is longer than the old forty polls bought.
 * Beyond that the printer is not coming back on its own: jam, cover open, out
 * of paper, offline. The kitchen board and the unprinted-order alert are the
 * right answer then, not a fifth copy-set.
 *
 * ⚠️ IF PRINT_OFFER_CAP IS SET IN THE ENVIRONMENT, LOWER IT. A value tuned for
 * the old poll-counting meaning (40) now means forty copy-sets over an hour.
 *
 * Split tickets are counted per PIECE, not per order: advancePrintSegment
 * resets the counter on every confirmed piece, so a five-piece job gets the
 * full allowance five times rather than sharing one.
 */
export function printOfferCap(): number {
  const n = intEnv("PRINT_OFFER_CAP", 4);
  // At least 1, or nothing would ever be offered twice.
  return Number.isFinite(n) && n >= 1 ? n : 4;
}

/**
 * FLOOR for the confirmation window — the minimum time a printer holding our
 * job body gets before we will believe the print died.
 *
 * This is everything in a print cycle that is not paper: the printer's own poll
 * interval before it even fetches the body, the download, the decode, and the
 * fact that the confirming DELETE rides the NEXT poll after the last cut rather
 * than the instant the paper stops moving. Sixty seconds is the value the
 * previous round of this bug already established as adequate for a single-copy
 * job; it is kept as the floor rather than re-derived.
 */
export function printConfirmFloorSeconds(): number {
  const n = intEnv("PRINT_CONFIRM_FLOOR_SECONDS", 60);
  // A zero floor would make a 1-copy job's window the per-copy value alone,
  // which is legal but almost certainly a typo. Clamped, not honoured.
  return Number.isFinite(n) && n >= 1 ? n : 60;
}

/**
 * PER-COPY allowance added on top of the floor: window = max(floor, copies × this).
 *
 * The term the old flat sixty-second cooldown was missing. A three-copy job is
 * three times the paper and three cutter cycles, and CloudPRNT confirms the
 * whole job once — so the window has to scale with the job or it expires
 * mid-print and buys the next copy-set. That is exactly what happened: three
 * copies came out, the window expired, and the server offered again.
 *
 * Thirty seconds per copy is far more than the paper needs — a ~1500px copy is
 * a couple of seconds of thermal head. It is sized against the failure being
 * fixed rather than against the happy path, because the two errors are not
 * symmetric: waiting too long on a dead print costs one delayed ticket that is
 * on the kitchen board the whole time and covered by the unprinted-order alert,
 * while waiting too little costs a duplicate copy-set and two cooks making the
 * same order. At the configured three copies this gives a 90s window.
 */
export function printSecondsPerCopy(): number {
  const n = intEnv("PRINT_SECONDS_PER_COPY", 30);
  return Number.isFinite(n) && n >= 0 ? n : 30;
}

/**
 * Attempts at which a RENDER failure stops being treated as transient.
 *
 * Deliberately far lower than the offer cap: a render failure is usually our
 * bug, and the point of retrying at all is only to survive a cold-start OOM or
 * a resource blip, not to grind against a template that cannot render.
 */
export function printRenderCap(): number {
  const n = intEnv("PRINT_RENDER_CAP", 3);
  return Number.isFinite(n) && n >= 1 ? n : 3;
}

/**
 * How long after giving up on a job we will still believe its confirmation.
 *
 * A DELETE naming a job we have already retired means the paper came out after
 * our patience ran out — the print was slower than we were, which is our
 * misjudgement and not the printer's failure. Inside this window we honour it;
 * outside it we log and leave the order failed, because by then staff have had
 * time to act on the board and a very old confirmation is likelier to be a
 * replay than news.
 *
 * Five minutes, not the ~1 minute the offer cap represents, and deliberately
 * longer than the cap: the whole reason to widen the cap is that printing can
 * take longer than we assumed, so the window that catches our remaining
 * misjudgement has to be wider still.
 */
export function lateConfirmationGraceSeconds(): number {
  const n = intEnv("LATE_CONFIRMATION_GRACE_SECONDS", 300);
  // 0 disables honouring late confirmations; they are still logged.
  return Number.isFinite(n) && n >= 0 ? n : 300;
}

export function verifiedPhoneTtlDays(): number {
  const days = intEnv("VERIFIED_PHONE_TTL_DAYS", 90);
  return Number.isFinite(days) && days > 0 ? days : 0;
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
