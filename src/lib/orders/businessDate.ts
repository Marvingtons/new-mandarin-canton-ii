/**
 * Restaurant-local time helpers for the orders path.
 *
 * Every date decision here resolves in the TENANT's timezone, never the
 * server's and never the customer's. A Vercel function running in UTC must not
 * decide that an 11:30pm Chula Vista order belongs to tomorrow's ticket run —
 * that would hand the first customer of the evening the number A-001 twice.
 *
 * Pure and injectable (`at`) so it is testable without mocking the clock, and
 * free of `server-only` so the /kitchen client can render the same dates the
 * server stored.
 */

/**
 * Offset of `timezone` from UTC at instant `at`, in milliseconds.
 * Positive west of Greenwich is NOT the convention here: this returns
 * (local wall clock - UTC), so America/Los_Angeles in summer is -7h.
 */
function zoneOffsetMs(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const get = (type: string) =>
    Number.parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);

  // Intl renders midnight as hour "24" in some engines; fold it to 0.
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - at.getTime();
}

/**
 * Restaurant-local YYYY-MM-DD — the business date that owns the daily order
 * sequence. en-CA gives ISO ordering without hand-assembling the parts.
 */
export function businessDateFor(timezone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * Turn a restaurant-local wall clock into an absolute instant.
 *
 * Two passes on purpose: the offset itself depends on the instant, so the
 * first guess is corrected using the offset that actually applies there. That
 * is what keeps the two DST changeover days honest.
 */
export function zonedWallClockToUtc(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
): Date {
  const guess = Date.UTC(year, month - 1, day, hours, minutes);
  const firstPass = new Date(guess - zoneOffsetMs(new Date(guess), timezone));
  return new Date(guess - zoneOffsetMs(firstPass, timezone));
}

/**
 * Resolve a pickup selection ("asap" or a 24h "HH:MM") to an absolute instant.
 *
 * "HH:MM" is interpreted on the CURRENT business date, which is correct
 * because pickupSlots() only ever offers times remaining in today's window.
 */
export function pickupInstant(
  value: string,
  timezone: string,
  leadMinutes: number,
  at: Date = new Date(),
): Date {
  if (value === "asap") {
    return new Date(at.getTime() + leadMinutes * 60_000);
  }

  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    // Unparseable slots are rejected upstream by isValidPickup(); this is a
    // last-resort so the column is never null rather than a silent wrong time.
    return new Date(at.getTime() + leadMinutes * 60_000);
  }

  const [year, month, day] = businessDateFor(timezone, at)
    .split("-")
    .map((n) => Number.parseInt(n, 10));

  return zonedWallClockToUtc(
    timezone,
    year,
    month,
    day,
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10),
  );
}

/** "6:45 PM" in the tenant's timezone. Used by the ticket and the board. */
export function formatPickupTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}
