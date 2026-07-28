/**
 * Ordering configuration — the one place the "Order Takeout" CTA's behavior is
 * decided. Hero, sticky bar, and any future CTA all route through
 * `orderTarget()`, so the destination is a single edit.
 *
 * The Clover hosted-ordering mode is gone: ordering is on-site now, and there
 * is no third-party checkout to hand off to.
 */

export type OrderTarget = { kind: "internal"; href: string };

/** Where the primary "Order Takeout" CTA points. */
export function orderTarget(): OrderTarget {
  return { kind: "internal", href: "/order" };
}

/** Value line shown beside ordering CTAs. */
export const ORDER_DIRECT_NOTE = "Order direct — no delivery-app fees";
