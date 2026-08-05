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
 * 875 bps on 4000c = 350.0c exactly; on 4040c it is 353.5c -> 354c. Rounding
 * is HALF-UP on the cent, which is what a register does and what the customer
 * is quoted.
 *
 * Both operands are integers and the only division is by the literal 10000, so
 * the intermediate is exact for every subtotal this restaurant can ring up:
 * `subtotalCents * rateBps` is well inside 2^53, and a quotient landing exactly
 * on .5 is exactly representable, so Math.round's half-up really is half-up
 * rather than a coin toss on float dust. This is the ONLY arithmetic that
 * turns a rate into money — nothing else may open-code it.
 */
export function taxCents(subtotalCents: number, rateBps: number): number {
  return Math.round((subtotalCents * rateBps) / 10000);
}
