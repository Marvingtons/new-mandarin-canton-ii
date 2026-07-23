/**
 * Tenant configuration types.
 *
 * This module is TYPES ONLY — no env reads, no secrets — so it is safe to
 * import from client components. The values themselves are resolved in
 * tenant.server.ts (server-only) and handed to client components as props.
 */

/** A single day's online-ordering window, in tenant-local 24h time. */
export interface OrderingWindow {
  /** "11:00" — first minute online orders are accepted. */
  open: string;
  /** "20:30" — last minute online orders are accepted (the cutoff). */
  close: string;
  closed?: boolean;
}

export type DayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

/**
 * Client-safe tenant values. NOTHING secret may ever be added here — this
 * object is serialized into the page and sent to the browser.
 */
export interface PublicTenantConfig {
  tenantId: string;
  /** IANA zone, e.g. "America/Los_Angeles". Drives hours, slots, order-number reset. */
  timezone: string;
  /** Sales tax in basis points (875 = 8.75%). null until confirmed. */
  taxRateBps: number | null;
  /** Tip percentages offered at checkout. Empty array = tips disabled. */
  tipPresets: number[];
  /** Prefix for the daily order sequence, e.g. "A" -> "A-017". */
  orderNumberPrefix: string;
  /** Minutes of prep time before the earliest ASAP / bookable slot. */
  pickupLeadMinutes: number;
  /** Granularity of scheduled pickup slots, in minutes. */
  pickupSlotIntervalMinutes: number;
  /** Per-day online-ordering window (may be narrower than dine-in hours). */
  orderingHours: Record<DayKey, OrderingWindow>;
}

/** Which Clover environment the server talks to. */
export type CloverEnv = "sandbox" | "production";
