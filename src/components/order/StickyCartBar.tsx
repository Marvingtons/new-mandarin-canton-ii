"use client";

import { useCart } from "@/lib/cart/CartContext";
import { useClaimBottomBar } from "@/lib/bottomBarSlot";
import { useT } from "@/lib/i18n/LocaleContext";
import { formatCents } from "@/lib/money";

/**
 * Mobile-only sticky bar: item count + running total + View Cart. Hidden when
 * the cart is empty.
 *
 * It CLAIMS the bottom slot while it is up, which sends the site-wide
 * StickyOrderBar away — the two used to stack in the same corner at the
 * same z-index and the order bar, being later in the DOM, won. See
 * lib/bottomBarSlot for the measurements.
 *
 * Same lift as StickyOrderBar, which is the same archetype of bar in the
 * same corner of the same screen. This one needs no clipping and no child
 * corner: its px-4 py-3 keeps the button clear of the curve.
 */
export default function StickyCartBar({ onView }: { onView: () => void }) {
  const { itemCount, subtotalCents, hydrated } = useCart();
  // Before the early return: hooks cannot sit behind a condition.
  const t = useT();
  const active = hydrated && itemCount > 0;
  useClaimBottomBar(active);
  if (!active) return null;

  return (
    /* env() on the container, not the button: the ink surface should
       extend under the home indicator and the gold button should stop
       above it. 0px on hardware without one. */
    <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-lg border-t border-gold/50 bg-ink px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:hidden">
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
