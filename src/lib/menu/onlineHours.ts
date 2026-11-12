import type { DayKey } from "@/config/tenant.types";

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

