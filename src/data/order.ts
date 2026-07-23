/**
 * Ordering configuration — the one place the "Order Takeout" CTA's
 * behavior is decided. The rest of the site stays integration-agnostic:
 * hero, sticky bar, and any future CTA all route through `orderTarget()`,
 * so switching from the on-site page to Clover hosted ordering is a
 * single env change with no component edits.
 *
 * Phase 3 (Clover) wiring:
 *   NEXT_PUBLIC_ORDER_MODE          = "clover_hosted" | "custom_cart"
 *   NEXT_PUBLIC_CLOVER_ORDERING_URL = the merchant's Clover ordering link
 * Both are read at build time (NEXT_PUBLIC_*, safe in the client bundle).
 */

export type OrderMode = "clover_hosted" | "custom_cart";

export const ORDER_MODE: OrderMode =
  process.env.NEXT_PUBLIC_ORDER_MODE === "custom_cart"
    ? "custom_cart"
    : "clover_hosted";

/**
 * The merchant's Clover Online Ordering link, once provided. Until it is
 * set, `orderTarget()` falls back to the on-site /order page — never a
 * dead button. ⚠️ CONFIRM the real URL (Clover Dashboard → Ecommerce).
 */
export const CLOVER_ORDERING_URL: string | null =
  process.env.NEXT_PUBLIC_CLOVER_ORDERING_URL || null;

export type OrderTarget =
  | { kind: "internal"; href: string }
  | { kind: "external"; href: string };

/**
 * Where the primary "Order Takeout" CTA points, resolved from config:
 *   - clover_hosted + a Clover URL → the hosted ordering page (new tab)
 *   - anything else                → the on-site /order page
 */
export function orderTarget(): OrderTarget {
  if (ORDER_MODE === "clover_hosted" && CLOVER_ORDERING_URL) {
    return { kind: "external", href: CLOVER_ORDERING_URL };
  }
  return { kind: "internal", href: "/order" };
}

/** Value line shown beside ordering CTAs. */
export const ORDER_DIRECT_NOTE = "Order direct — no delivery-app fees";
