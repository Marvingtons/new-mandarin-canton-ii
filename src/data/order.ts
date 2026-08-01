/**
 * Ordering configuration — the one place the "Order Takeout" CTA's behavior is
 * decided. Hero, sticky bar, and any future CTA all route through
 * `orderTarget()`, so the destination is a single edit.
 *
 * The Clover hosted-ordering mode is gone: ordering is on-site now, and there
 * is no third-party checkout to hand off to.
 */

export type OrderTarget = { kind: "internal"; href: string };

/**
 * Where the primary "Order Takeout" CTA points.
 *
 * /menu, not /order: browsing and ordering are one surface now, and /order
 * redirects here. The hash is the difference between the two hero CTAs —
 * "View Menu" lands at the top of the page, this one lands on the grid — so
 * both go to the same live menu with different emphasis rather than to two
 * pages showing the same dishes.
 */
export function orderTarget(): OrderTarget {
  return { kind: "internal", href: "/menu#order" };
}

/* The value line that used to live here as ORDER_DIRECT_NOTE is now
   `hero.orderDirect` in lib/i18n/dictionary.ts. It sits inside a sentence
   that ends in a translated "Call", so keeping it out here meant a Spanish
   hero rendered half of one line in English. Anything a customer READS
   belongs in the dictionary; this file decides where a CTA goes. */
