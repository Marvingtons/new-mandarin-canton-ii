"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "@/lib/cart/CartContext";
import { restaurant } from "@/data/restaurant";
import { formatCents, taxCents } from "@/lib/money";
import { pickupSlots, type PickupOptions, type PickupSlot } from "@/lib/order/pickup";
import CloverPayment, {
  type CloverPaymentHandle,
} from "@/components/order/CloverPayment";

/** Payload handed to the confirmation screen via sessionStorage. */
export interface LastOrder {
  orderNumber: string;
  chargeId: string;
  total: number;
  pickupTime: string;
}

interface CheckoutProps {
  sdkUrl: string;
  publicToken: string | null;
  merchantId: string | null;
  timezone: string;
  leadMinutes: number;
  intervalMinutes: number;
  taxRateBps: number | null;
}

const LAST_ORDER_KEY = "nmc-last-order";

export default function Checkout({
  sdkUrl,
  publicToken,
  merchantId,
  timezone,
  leadMinutes,
  intervalMinutes,
  taxRateBps,
}: CheckoutProps) {
  const router = useRouter();
  const { detailedLines, lines, subtotalCents, hydrated, clear } = useCart();
  const payRef = useRef<CloverPaymentHandle>(null);
  const idempotencyKeyRef = useRef<string>("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [time, setTime] = useState("");
  const [slots, setSlots] = useState<PickupSlot[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickupOpts = useMemo<PickupOptions>(
    () => ({ timezone, leadMinutes, intervalMinutes }),
    [timezone, leadMinutes, intervalMinutes],
  );

  // Compute pickup slots on the client (needs "now"). Refresh each minute so a
  // slot that just passed drops out.
  useEffect(() => {
    const compute = () => {
      const next = pickupSlots(new Date(), pickupOpts);
      setSlots(next);
      setTime((t) => (t && next.some((s) => s.value === t) ? t : next[0]?.value ?? ""));
    };
    compute();
    const id = setInterval(compute, 60_000);
    return () => clearInterval(id);
  }, [pickupOpts]);

  const tax = taxRateBps != null ? taxCents(subtotalCents, taxRateBps) : 0;
  const total = subtotalCents + tax;

  const phoneValid = phone.replace(/\D/g, "").length >= 10;
  const canSubmit =
    hydrated &&
    detailedLines.length > 0 &&
    name.trim().length > 0 &&
    phoneValid &&
    time.length > 0 &&
    slots.length > 0 &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return; // hard double-submit guard
    setError(null);

    if (!name.trim()) return setError("Please enter your name.");
    if (!phoneValid) return setError("Please enter a valid phone number.");
    if (!time || slots.length === 0)
      return setError("Please choose a pickup time.");

    setSubmitting(true);
    try {
      const token = await payRef.current!.tokenize();

      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      }

      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // IDs and quantities only — never prices. The server recomputes.
          lines: lines.map((l) => ({
            itemId: l.itemId,
            sizeId: l.sizeId,
            modifierIds: l.modifierIds,
            quantity: l.quantity,
            specialInstructions: l.specialInstructions,
          })),
          pickup: { name: name.trim(), phone: phone.trim(), time },
          cardToken: token,
          idempotencyKey: idempotencyKeyRef.current,
        }),
      });

      const data = (await res.json()) as
        | ({ ok: true } & LastOrder)
        | { ok: false; error: string };

      if (!res.ok || !data.ok) {
        setError(
          ("error" in data && data.error) ||
            "We couldn't process your order. Please try again.",
        );
        setSubmitting(false);
        return;
      }

      const last: LastOrder = {
        orderNumber: data.orderNumber,
        chargeId: data.chargeId,
        total: data.total,
        pickupTime: data.pickupTime,
      };
      try {
        sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify(last));
      } catch {
        /* non-fatal */
      }
      clear();
      router.push("/order/confirmation");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn't process your payment. Please try again.",
      );
      setSubmitting(false);
    }
  }

  if (hydrated && detailedLines.length === 0) {
    return (
      <div className="container-wide flex flex-col items-center gap-3 py-24 text-center">
        <h1 className="font-display text-3xl text-lacquer">Your cart is empty</h1>
        <p className="text-ink/70">Add a few dishes to start a pickup order.</p>
        <Link
          href="/order"
          className="mt-2 inline-flex min-h-12 items-center bg-gold px-6 font-semibold text-ink hover:bg-gold-light"
        >
          Back to menu
        </Link>
      </div>
    );
  }

  return (
    <div className="container-wide grid gap-10 py-10 lg:grid-cols-[1fr_360px]">
      {/* Left: forms */}
      <form onSubmit={handleSubmit} className="order-2 lg:order-1">
        <h1 className="font-display text-4xl text-lacquer">Checkout</h1>
        <p className="mt-2 text-sm uppercase tracking-[0.15em] text-ink/55">
          Pickup only · {restaurant.address.street}
        </p>

        {/* Pickup details */}
        <fieldset className="mt-8">
          <legend className="font-display text-2xl text-ink">
            Pickup details
          </legend>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-ink/60">
                Name
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
                className="w-full border border-gold/50 bg-ivory px-3 py-3 text-ink outline-none focus:border-lacquer"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-ink/60">
                Phone
              </span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                inputMode="tel"
                autoComplete="tel"
                className="w-full border border-gold/50 bg-ivory px-3 py-3 text-ink outline-none focus:border-lacquer"
              />
            </label>
          </div>
          <label className="mt-4 block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-ink/60">
              Pickup time
            </span>
            {slots.length > 0 ? (
              <select
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full border border-gold/50 bg-ivory px-3 py-3 text-ink outline-none focus:border-lacquer"
              >
                {slots.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            ) : (
              <p className="border border-lacquer/40 bg-lacquer/5 px-3 py-3 text-sm text-lacquer">
                We&apos;re closed right now. Please order during store hours.
              </p>
            )}
          </label>
        </fieldset>

        {/* Payment */}
        <fieldset className="mt-8">
          <legend className="font-display text-2xl text-ink">Payment</legend>
          <p className="mb-3 mt-1 text-sm text-ink/60">
            Your card is entered securely in Clover&apos;s payment fields — it
            never touches our servers.
          </p>
          <CloverPayment
            ref={payRef}
            sdkUrl={sdkUrl}
            publicToken={publicToken}
            merchantId={merchantId}
          />
        </fieldset>

        {error && (
          <p
            role="alert"
            className="mt-6 border border-lacquer/40 bg-lacquer/5 px-4 py-3 text-sm font-medium text-lacquer"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-6 flex min-h-12 w-full items-center justify-center bg-gold px-6 font-semibold text-ink transition-colors hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Placing order…" : `Pay ${formatCents(total)} · Pickup`}
        </button>
        <p className="mt-2 text-center text-xs uppercase tracking-[0.15em] text-ink/50">
          Pickup only · no delivery
        </p>
      </form>

      {/* Right: order summary */}
      <aside className="order-1 h-max border border-gold/40 bg-cream px-5 py-5 lg:order-2 lg:sticky lg:top-6">
        <h2 className="font-display text-2xl text-ink">Your order</h2>
        <ul className="mt-4 divide-y divide-gold/20">
          {detailedLines.map((line) => (
            <li key={line.lineId} className="flex justify-between gap-3 py-3 text-sm">
              <span className="min-w-0">
                <span className="font-semibold text-ink">
                  {line.quantity}× {line.item.nameEn}
                </span>
                {line.size.label !== "Regular" && (
                  <span className="block text-ink/60">{line.size.label}</span>
                )}
                {line.modifiers.length > 0 && (
                  <span className="block text-ink/60">
                    {line.modifiers.map((m) => m.nameEn).join(", ")}
                  </span>
                )}
              </span>
              <span className="shrink-0 font-semibold text-lacquer">
                {formatCents(line.lineCents)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1 border-t border-gold/20 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink/70">Subtotal</dt>
            <dd className="text-ink">{formatCents(subtotalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink/70">Tax</dt>
            <dd className="text-ink">
              {taxRateBps != null ? formatCents(tax) : "—"}
            </dd>
          </div>
          <div className="flex justify-between border-t border-gold/20 pt-1 text-base font-semibold">
            <dt className="text-ink">Total</dt>
            <dd className="text-lacquer">{formatCents(total)}</dd>
          </div>
        </dl>
        <Link
          href="/order"
          className="mt-4 inline-block text-sm text-ink/60 underline underline-offset-2 hover:text-lacquer"
        >
          ← Edit order
        </Link>
      </aside>
    </div>
  );
}
