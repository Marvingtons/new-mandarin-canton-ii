import type { DayKey, PublicTenantConfig } from "@/config/tenant.types";

/**
 * Online-ordering window logic.
 *
 * Pure and tenant-config driven so it runs identically on the server (gating
 * checkout) and the client (disabling the cart), and so it can be unit-tested
 * without mocking the clock.
 *
 * All reasoning happens in the TENANT's timezone, never the server's or the
 * customer's — a Vercel function in UTC must not decide that a Chula Vista
 * kitchen is closed.
 */

const DAY_BY_INDEX: DayKey[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** "20:30" -> 1230 minutes past midnight. */
function parseHHMM(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number.parseInt(m[1], 10);
  const min = Number.parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export interface TenantNow {
  day: DayKey;
  /** Minutes past local midnight. */
  minutes: number;
}

/**
 * Resolve "now" in the tenant's timezone. Uses Intl rather than a date library
 * so DST is handled by the platform's tz database, not by us.
 */
export function tenantNow(timezone: string, at: Date = new Date()): TenantNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    get("weekday"),
  );
  // Intl can render midnight as "24" in some locales/engines; fold it to 0.
  const hour = Number.parseInt(get("hour"), 10) % 24;
  const minute = Number.parseInt(get("minute"), 10);

  return {
    day: DAY_BY_INDEX[weekdayIndex >= 0 ? weekdayIndex : 0],
    minutes: (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0),
  };
}

export interface OrderingStatus {
  open: boolean;
  /** Bilingual reason, ready to render. */
  reasonEn: string;
  reasonZh: string;
  /** Today's window in local time, when there is one. */
  opensAt: string | null;
  closesAt: string | null;
}

/**
 * Is online ordering accepting orders right now?
 *
 * Note this is the ONLINE window, which is intentionally narrower than the
 * dine-in hours (the kitchen needs time to cook the last order before close).
 */
export function orderingStatus(
  tenant: PublicTenantConfig,
  at: Date = new Date(),
): OrderingStatus {
  const now = tenantNow(tenant.timezone, at);
  const window = tenant.orderingHours[now.day];

  if (!window || window.closed) {
    return {
      open: false,
      reasonEn: "Online ordering is closed today.",
      reasonZh: "今日暫停網上訂餐。",
      opensAt: null,
      closesAt: null,
    };
  }

  const open = parseHHMM(window.open);
  const close = parseHHMM(window.close);
  if (open === null || close === null) {
    return {
      open: false,
      reasonEn: "Online ordering is unavailable right now.",
      reasonZh: "網上訂餐暫時無法使用。",
      opensAt: null,
      closesAt: null,
    };
  }

  if (now.minutes < open) {
    return {
      open: false,
      reasonEn: `Online ordering opens at ${window.open}.`,
      reasonZh: `網上訂餐於 ${window.open} 開始。`,
      opensAt: window.open,
      closesAt: window.close,
    };
  }

  if (now.minutes >= close) {
    return {
      open: false,
      reasonEn: `Online ordering has closed for today (last order ${window.close}).`,
      reasonZh: `今日網上訂餐已結束（最後落單 ${window.close}）。`,
      opensAt: window.open,
      closesAt: window.close,
    };
  }

  return {
    open: true,
    reasonEn: `Ordering until ${window.close}.`,
    reasonZh: `落單至 ${window.close}。`,
    opensAt: window.open,
    closesAt: window.close,
  };
}
