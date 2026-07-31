"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatCents } from "@/lib/money";
import PhoneLinks from "@/components/PhoneLinks";
import { fullAddress } from "@/data/restaurant";
import type { LastOrder } from "@/components/order/Checkout";

const LAST_ORDER_KEY = "nmc-last-order";

/**
 * Pickup confirmation. Reads the just-placed order from sessionStorage (set by
 * Checkout on success). A direct visit with no order shows a gentle fallback.
 */
export default function ConfirmationPage() {
  const [order, setOrder] = useState<LastOrder | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Read the just-placed order from sessionStorage after mount — the same
    // hydration-safe pattern as the cart (server render has no order).
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const raw = sessionStorage.getItem(LAST_ORDER_KEY);
      if (raw) setOrder(JSON.parse(raw) as LastOrder);
    } catch {
      /* ignore */
    }
    setLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  if (!loaded) return null;

  if (!order) {
    return (
      <div className="container-wide flex flex-col items-center gap-3 py-24 text-center">
        <h1 className="font-display text-3xl text-lacquer">No recent order</h1>
        <p className="text-ink/70">
          Start a new pickup order from the menu.
        </p>
        <Link
          href="/menu#order"
          className="mt-2 inline-flex min-h-12 items-center rounded-lg bg-gold px-6 font-semibold text-ink hover:bg-gold-light"
        >
          Order pickup
        </Link>
      </div>
    );
  }

  return (
    <div className="container-wide flex flex-col items-center py-16 text-center">
      <span
        aria-hidden="true"
        className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-gold text-3xl text-gold"
      >
        ✓
      </span>
      <h1 className="mt-6 font-display text-4xl text-lacquer">Order confirmed</h1>
      <p className="mt-2 text-ink/75">
        Thank you — your order is with the kitchen. This is a{" "}
        <span className="font-semibold text-ink">pickup order</span>: collect it
        at the counter and pay when you do.
      </p>

      <dl className="mt-8 w-full max-w-md divide-y divide-gold/20 overflow-hidden rounded-md border border-gold/40 bg-cream text-left">
        <div className="flex justify-between px-5 py-3">
          <dt className="text-ink/70">Order number</dt>
          <dd className="font-display text-xl text-lacquer">
            {order.orderNumber}
          </dd>
        </div>
        <div className="flex justify-between px-5 py-3">
          <dt className="text-ink/70">Ready around</dt>
          <dd className="text-right font-semibold text-ink">
            {/* The window the server stored at order creation — the same one
                on the ticket and the kitchen board. Clock time, not "in 17
                minutes": this page gets re-read later. */}
            {order.readyWindow ?? order.pickupTime}
            {order.longPrep && (
              <span className="mt-0.5 block text-xs font-normal text-ink/60">
                Party trays &amp; family dinners need a little longer
              </span>
            )}
          </dd>
        </div>
        <div className="flex justify-between px-5 py-3">
          <dt className="text-ink/70">Due at pickup</dt>
          <dd className="font-semibold text-ink">{formatCents(order.total)}</dd>
        </div>
      </dl>

      <div className="mt-8 text-sm text-ink/70">
        <p className="font-semibold text-ink">Pickup location</p>
        <p className="mt-1">{fullAddress}</p>
        <p className="mt-2 font-semibold text-lacquer">
          <PhoneLinks
            prefix="Call "
            separator=" or "
            className="underline underline-offset-2"
          />
        </p>
      </div>

      <Link
        href="/menu"
        className="mt-8 text-sm text-ink/60 underline underline-offset-2 hover:text-lacquer"
      >
        Back to the menu
      </Link>
    </div>
  );
}
