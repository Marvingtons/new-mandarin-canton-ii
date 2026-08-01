"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatCents } from "@/lib/money";
import PhoneLinks from "@/components/PhoneLinks";
import { fullAddress } from "@/data/restaurant";
import { useT } from "@/lib/i18n/LocaleContext";
import type { LastOrder } from "@/components/order/Checkout";

const LAST_ORDER_KEY = "nmc-last-order";

/**
 * Pickup confirmation. Reads the just-placed order from sessionStorage (set by
 * Checkout on success). A direct visit with no order shows a gentle fallback.
 */
export default function ConfirmationPage() {
  const t = useT();
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
        <h1 className="font-display text-3xl text-lacquer">
          {t("conf.noOrder")}
        </h1>
        <p className="text-ink/70">{t("conf.noOrderHint")}</p>
        <Link
          href="/menu#order"
          className="mt-2 inline-flex min-h-12 items-center rounded-lg bg-gold px-6 font-semibold text-ink hover:bg-gold-light"
        >
          {t("conf.orderPickup")}
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
      <h1 className="mt-6 font-display text-4xl text-lacquer">
        {t("conf.title")}
      </h1>
      <p className="mt-2 text-ink/75">
        {t("conf.thanks")}{" "}
        <span className="font-semibold text-ink">{t("conf.pickupOrder")}</span>
        {t("conf.collectAndPay")}
      </p>

      <dl className="mt-8 w-full max-w-md divide-y divide-gold/20 overflow-hidden rounded-md border border-gold/40 bg-cream text-left">
        <div className="flex justify-between px-5 py-3">
          <dt className="text-ink/70">{t("conf.orderNumber")}</dt>
          <dd className="font-display text-xl text-lacquer">
            {order.orderNumber}
          </dd>
        </div>
        <div className="flex justify-between px-5 py-3">
          <dt className="text-ink/70">{t("conf.readyAround")}</dt>
          <dd className="text-right font-semibold text-ink">
            {/* The window the server stored at order creation — the same one
                on the ticket and the kitchen board. Clock time, not "in 17
                minutes": this page gets re-read later. */}
            {order.readyWindow ?? order.pickupTime}
            {order.longPrep && (
              <span className="mt-0.5 block text-xs font-normal text-ink/60">
                {t("conf.longPrepNote")}
              </span>
            )}
          </dd>
        </div>
        <div className="flex justify-between px-5 py-3">
          <dt className="text-ink/70">{t("checkout.dueAtPickup")}</dt>
          <dd className="font-semibold text-ink">{formatCents(order.total)}</dd>
        </div>
      </dl>

      {/* Only when something in the notes looked allergy-shaped. This is
          best effort and it knows it: the order is already placed, so the
          line is not a safeguard, it is a last chance to pick up the phone
          before the food is cooked. Never blocks anything. */}
      {order.allergyNote && (
        <p className="mt-8 w-full max-w-md rounded-md border border-lacquer/40 bg-lacquer/5 px-4 py-3 text-left text-sm text-ink/80">
          <span className="font-semibold text-lacquer">
            {t("conf.allergyHeading")}
          </span>{" "}
          <span lang="zh-Hant" className="font-chinese text-ink/75">
            · 過敏問題請致電
          </span>{" "}
          {t("conf.allergyBody")}
        </p>
      )}

      <div className="mt-8 text-sm text-ink/70">
        <p className="font-semibold text-ink">{t("conf.pickupLocation")}</p>
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
        {t("conf.backToMenu")}
      </Link>
    </div>
  );
}
