"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useCart } from "@/lib/cart/CartContext";
import { formatCents, taxCents } from "@/lib/money";

/**
 * Slide-over cart. Lines with size + modifiers + instructions, quantity edit,
 * remove, and a subtotal / tax / total summary. Tax is shown when the rate is
 * configured; otherwise it is deferred to checkout (server is authoritative
 * either way). Pickup only.
 */
export default function CartDrawer({
  open,
  onClose,
  taxRateBps,
}: {
  open: boolean;
  onClose: () => void;
  taxRateBps: number | null;
}) {
  const { detailedLines, subtotalCents, itemCount, updateQuantity, remove } =
    useCart();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const tax = taxRateBps != null ? taxCents(subtotalCents, taxRateBps) : null;
  const total = tax != null ? subtotalCents + tax : subtotalCents;

  return (
    <>
      {open && (
        <button
          aria-label="Close cart"
          className="fixed inset-0 z-[60] bg-ink/50"
          onClick={onClose}
        />
      )}
      <aside
        aria-label="Your pickup order"
        aria-hidden={!open}
        className={`fixed inset-y-0 right-0 z-[65] flex w-full max-w-md flex-col bg-cream shadow-xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-gold/30 px-5 py-4">
          <h2 className="font-display text-2xl text-ink">
            Your Pickup Order
          </h2>
          <button
            onClick={onClose}
            aria-label="Close cart"
            className="rounded-full px-2 text-2xl leading-none text-ink/60 hover:text-ink"
          >
            ×
          </button>
        </div>

        {detailedLines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="font-display text-xl text-ink/70">Your cart is empty</p>
            <p className="text-sm text-ink/55">
              Add a few dishes to start your pickup order.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4" data-lenis-prevent>
            <ul className="divide-y divide-gold/20">
              {detailedLines.map((line) => (
                <li key={line.lineId} className="py-4">
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{line.item.nameEn}</p>
                      {line.size.label !== "Regular" && (
                        <p className="text-sm text-ink/60">{line.size.label}</p>
                      )}
                      {line.modifiers.length > 0 && (
                        <p className="text-sm text-ink/60">
                          {line.modifiers.map((m) => m.nameEn).join(", ")}
                        </p>
                      )}
                      {line.specialInstructions && (
                        <p className="mt-0.5 text-sm italic text-ink/55">
                          “{line.specialInstructions}”
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 font-semibold text-lacquer">
                      {formatCents(line.lineCents)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex items-center border border-gold/50">
                      <button
                        onClick={() =>
                          updateQuantity(line.lineId, line.quantity - 1)
                        }
                        aria-label={`Decrease ${line.item.nameEn}`}
                        className="min-h-9 w-9 text-lg text-ink hover:bg-gold/10"
                      >
                        −
                      </button>
                      <span className="w-7 text-center text-sm font-semibold text-ink">
                        {line.quantity}
                      </span>
                      <button
                        onClick={() =>
                          updateQuantity(line.lineId, line.quantity + 1)
                        }
                        aria-label={`Increase ${line.item.nameEn}`}
                        className="min-h-9 w-9 text-lg text-ink hover:bg-gold/10"
                      >
                        +
                      </button>
                    </div>
                    <button
                      onClick={() => remove(line.lineId)}
                      className="text-sm text-ink/55 underline underline-offset-2 hover:text-lacquer"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {detailedLines.length > 0 && (
          <div className="border-t border-gold/30 px-5 py-4">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink/70">Subtotal</dt>
                <dd className="text-ink">{formatCents(subtotalCents)}</dd>
              </div>
              {tax != null ? (
                <div className="flex justify-between">
                  <dt className="text-ink/70">Tax</dt>
                  <dd className="text-ink">{formatCents(tax)}</dd>
                </div>
              ) : (
                <div className="flex justify-between">
                  <dt className="text-ink/70">Tax</dt>
                  <dd className="text-ink/55">calculated at checkout</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-gold/20 pt-1 text-base font-semibold">
                <dt className="text-ink">Total</dt>
                <dd className="text-lacquer">{formatCents(total)}</dd>
              </div>
            </dl>
            <Link
              href="/order/checkout"
              onClick={onClose}
              className="mt-4 flex min-h-12 items-center justify-center bg-gold px-5 font-semibold text-ink transition-colors hover:bg-gold-light"
            >
              Checkout · {itemCount} {itemCount === 1 ? "item" : "items"}
            </Link>
            <p className="mt-2 text-center text-xs uppercase tracking-[0.15em] text-ink/50">
              Pickup only · no delivery
            </p>
          </div>
        )}
      </aside>
    </>
  );
}
