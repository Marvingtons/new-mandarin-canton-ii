"use client";

import { useCart } from "@/lib/cart/CartContext";
import { formatCents } from "@/lib/money";

/**
 * Mobile-only sticky bar: item count + running total + View Cart. Hidden when
 * the cart is empty. Sits above the site-wide order bar on the /order route.
 */
export default function StickyCartBar({ onView }: { onView: () => void }) {
  const { itemCount, subtotalCents, hydrated } = useCart();
  if (!hydrated || itemCount === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-gold/50 bg-ink px-4 py-3 sm:hidden">
      <button
        onClick={onView}
        className="flex w-full items-center justify-between gap-3 bg-gold px-4 py-3 font-semibold text-ink"
      >
        <span className="flex items-center gap-2">
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-ink px-1.5 text-sm text-ivory">
            {itemCount}
          </span>
          View Cart
        </span>
        <span>{formatCents(subtotalCents)}</span>
      </button>
    </div>
  );
}
