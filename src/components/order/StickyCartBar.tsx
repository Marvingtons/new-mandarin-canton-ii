"use client";

import { useCart } from "@/lib/cart/CartContext";
import { useT } from "@/lib/i18n/LocaleContext";
import { formatCents } from "@/lib/money";

/**
 * Mobile-only sticky bar: item count + running total + View Cart. Hidden when
 * the cart is empty. Sits above the site-wide order bar on the /order route.
 *
 * Same lift as StickyOrderBar, which is the same archetype of bar in the
 * same corner of the same screen. This one needs no clipping and no child
 * corner: its px-4 py-3 keeps the button clear of the curve.
 */
export default function StickyCartBar({ onView }: { onView: () => void }) {
  const { itemCount, subtotalCents, hydrated } = useCart();
  // Before the early return: hooks cannot sit behind a condition.
  const t = useT();
  if (!hydrated || itemCount === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-lg border-t border-gold/50 bg-ink px-4 py-3 sm:hidden">
      <button
        onClick={onView}
        className="flex w-full items-center justify-between gap-3 rounded-lg bg-gold px-4 py-3 font-semibold text-ink"
      >
        <span className="flex items-center gap-2">
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-ink px-1.5 text-sm text-ivory">
            {itemCount}
          </span>
          {t("cart.viewCart")}
        </span>
        <span>{formatCents(subtotalCents)}</span>
      </button>
    </div>
  );
}
