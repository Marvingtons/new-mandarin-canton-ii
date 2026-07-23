/**
 * Money helpers. Every amount in this app is INTEGER CENTS — no floats ever
 * touch a price calculation. Formatting to dollars happens only at the display
 * edge, here.
 */

/** 1995 -> "$19.95". Negative-safe. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}$${dollars}.${String(rem).padStart(2, "0")}`;
}

/**
 * Apply a basis-point tax rate to a cents subtotal, returning integer cents.
 * 775 bps on 1000c = 77.5c -> rounds to 78c. Rounding is half-up on the cent.
 */
export function taxCents(subtotalCents: number, rateBps: number): number {
  return Math.round((subtotalCents * rateBps) / 10000);
}
