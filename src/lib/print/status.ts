import "server-only";

/**
 * Is a printer expected at all?
 *
 * Purely informational — it drives one banner on the kitchen board. Nothing
 * depends on it being true: the board is designed to be the only copy of an
 * order, and "no printer" is a supported configuration rather than an error.
 */
export function cloudPrntConfigured(): boolean {
  return Boolean(process.env.CLOUDPRNT_SECRET);
}
