"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "@/lib/cart/CartContext";
import { useT } from "@/lib/i18n/LocaleContext";
import PhoneLinks from "@/components/PhoneLinks";
import { restaurant } from "@/data/restaurant";
import { formatCents, taxCents } from "@/lib/money";
import {
  caretAfterFormat,
  formatPhoneAsTyped,
  normalizePhone,
  phoneErrorMessage,
} from "@/lib/phone";
import { pickupSlots, type PickupOptions, type PickupSlot } from "@/lib/order/pickup";
import { mentionsAllergy } from "@/lib/order/allergyHint";
import { closedMessage } from "@/lib/order/gates";

/** Payload handed to the confirmation screen via sessionStorage. */
export interface LastOrder {
  orderNumber: string;
  total: number;
  pickupTime: string;
  /** "6:45–6:50 PM", from the window the server stored. Null on old orders. */
  readyWindow?: string | null;
  /** True when a tray or family dinner pushed the order to 20–30 minutes. */
  longPrep?: boolean;
  /**
   * Something in the special instructions read like it might be about an
   * allergy, so the confirmation screen repeats the "call us" line.
   *
   * Computed HERE rather than read back on the confirmation page, because
   * that page never receives the order lines — it gets this summary and
   * nothing else. Best effort, and absent on orders placed before this
   * field existed, which is why it is optional.
   */
  allergyNote?: boolean;
}

interface CheckoutProps {
  timezone: string;
  leadMinutes: number;
  intervalMinutes: number;
  taxRateBps: number | null;
  /**
   * This browser holds a valid test-mode session, read SERVER-side from the
   * httpOnly cookie (see TestModeBadge, and lib/order/bypass.ts).
   *
   * Presentation only. It unlocks the selector so the ordering UI can be
   * driven while closed; whether the submitted value is accepted is decided
   * by the server, which re-reads the same cookie and does not trust this
   * prop. A browser that set it by hand would get slots it cannot submit.
   */
  testMode?: boolean;
}

const LAST_ORDER_KEY = "nmc-last-order";

type VerifyState = "idle" | "sending" | "sent" | "checking";

/**
 * Pickup checkout. No payment — the customer pays at the counter.
 *
 * What replaces the card is the phone verification below. It is not a
 * formality: the server will not accept an order without the httpOnly cookie
 * that /api/otp/check sets, and it files the order under the number inside
 * that cookie rather than the one in this form. So the UI here cannot lie
 * about verification even if someone edits it — the worst it can do is
 * confuse the person using it.
 */
export default function Checkout({
  timezone,
  leadMinutes,
  intervalMinutes,
  taxRateBps,
  testMode = false,
}: CheckoutProps) {
  const router = useRouter();
  const t = useT();
  const { detailedLines, lines, subtotalCents, hydrated, clear } = useCart();
  const idempotencyKeyRef = useRef<string>("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [time, setTime] = useState("");
  const [slots, setSlots] = useState<PickupSlot[]>([]);
  const [verify, setVerify] = useState<VerifyState>("idle");
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Why no slots are offerable, in the server's own words. Null when open. */
  const [closedNote, setClosedNote] = useState<string | null>(null);

  const pickupOpts = useMemo<PickupOptions>(
    () => ({ timezone, leadMinutes, intervalMinutes }),
    [timezone, leadMinutes, intervalMinutes],
  );

  // Compute pickup slots on the client (needs "now"). Refresh each minute so a
  // slot that just passed drops out.
  //
  // The refusal line is computed in the SAME tick, from the same clock, by
  // the same function the server refuses with (closedMessage). It used to
  // be a hardcoded "We're closed right now. Please order during store
  // hours." — which was survivable while the cutoff was a flat 20 minutes,
  // and became a lie the moment it went per-day: on a Saturday the doors
  // are open until 9:30 but the site stops at 8:30, so for a full hour
  // that string told people the restaurant was shut while the lights were
  // on. closedMessage already knows the difference and says so bilingually.
  useEffect(() => {
    const compute = () => {
      const at = new Date();
      const next = pickupSlots(at, pickupOpts, { asIfOpen: testMode });
      setSlots(next);
      setClosedNote(next.length === 0 ? closedMessage(at, pickupOpts) : null);
      setTime((t) => (t && next.some((s) => s.value === t) ? t : next[0]?.value ?? ""));
    };
    compute();
    const id = setInterval(compute, 60_000);
    return () => clearInterval(id);
  }, [pickupOpts, testMode]);

  const tax = taxRateBps != null ? taxCents(subtotalCents, taxRateBps) : 0;
  const total = subtotalCents + tax;

  const phoneCheck = normalizePhone(phone);

  /**
   * Live "(858) 207-7770" masking.
   *
   * The state holds the FORMATTED text because that is what the input shows,
   * but nothing downstream reads it: every API call runs the value through
   * normalizePhone() first, so the wire always carries E.164. Paste is handled
   * for free — phoneDigits strips punctuation, "+" and a leading country code.
   *
   * The caret is restored after React commits, in digit terms rather than
   * character terms, so typing or backspacing mid-number does not throw the
   * cursor to the end.
   */
  const phoneRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);

  const onPhoneChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const formatted = formatPhoneAsTyped(raw);
    caretRef.current = caretAfterFormat(raw, e.target.selectionStart ?? raw.length, formatted);
    setPhone(formatted);
  }, []);

  useEffect(() => {
    const at = caretRef.current;
    caretRef.current = null;
    if (at === null) return;
    const el = phoneRef.current;
    // Only reposition while the field is focused; doing it otherwise would
    // steal the caret back from wherever the customer has moved on to.
    if (el && document.activeElement === el) el.setSelectionRange(at, at);
  }, [phone]);

  /**
   * Verification is DERIVED, not stored — editing the phone after verifying
   * silently un-verifies it.
   *
   * Deliberately not an effect that resets state: this comparison is the truth
   * at every render, so there is no window in which the form shows "verified"
   * for a number the server would reject. The server rejects the mismatch
   * regardless; this just stops the UI from lying about it first.
   */
  const isVerified =
    verifiedPhone !== null && phoneCheck.e164 === verifiedPhone;

  /**
   * Returning customers skip the SMS.
   *
   * The remember cookie is httpOnly, so this cannot read it — it asks the
   * server whether THIS number is already proved by THIS browser. Purely to
   * decide what to show: /api/orders re-checks the same cookie itself, so a
   * client that lied here would simply be rejected at submit.
   *
   * Fires once per complete number. Changing the number re-asks for the new
   * one, and a number the browser has not proved just falls through to the
   * normal Send code flow.
   */
  const askedRef = useRef<string | null>(null);
  useEffect(() => {
    const e164 = phoneCheck.ok ? phoneCheck.e164 : null;
    if (!e164 || verifiedPhone === e164 || askedRef.current === e164) return;
    askedRef.current = e164;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/otp/status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phone: e164 }),
        });
        const data = (await res.json()) as { ok: boolean; verified?: boolean };
        if (!cancelled && res.ok && data.verified) setVerifiedPhone(e164);
      } catch {
        /* offline or blocked — the customer just verifies by SMS as before */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phoneCheck.ok, phoneCheck.e164, verifiedPhone]);

  const sendCode = useCallback(async () => {
    setError(null);
    setNotice(null);

    if (!phoneCheck.ok) {
      setError(phoneErrorMessage(phoneCheck.error ?? "invalid_exchange"));
      return;
    }

    setVerify("sending");
    try {
      const res = await fetch("/api/otp/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = (await res.json()) as
        | { ok: true; last4: string }
        | { ok: false; error: string };

      if (!res.ok || !data.ok) {
        setError("error" in data ? data.error : t("err.codeNotSent"));
        setVerify("idle");
        return;
      }
      setNotice(t("otp.codeSent", { last4: data.last4 }));
      setVerify("sent");
    } catch {
      setError(`${t("err.noReachServer")} · ${t("err.noReachServerZh")}`);
      setVerify("idle");
    }
  }, [phone, phoneCheck, t]);

  const submitCode = useCallback(async () => {
    setError(null);
    setVerify("checking");
    try {
      const res = await fetch("/api/otp/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const data = (await res.json()) as
        | { ok: true; last4: string }
        | { ok: false; error: string };

      if (!res.ok || !data.ok) {
        setError("error" in data ? data.error : t("err.codeWrong"));
        setVerify("sent");
        return;
      }
      setVerifiedPhone(phoneCheck.e164 ?? null);
      setNotice(null);
    } catch {
      setError(`${t("err.noReachServer")} · ${t("err.noReachServerZh")}`);
      setVerify("sent");
    }
  }, [phone, code, phoneCheck, t]);

  const canSubmit =
    hydrated &&
    detailedLines.length > 0 &&
    name.trim().length > 0 &&
    isVerified &&
    time.length > 0 &&
    slots.length > 0 &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return; // hard double-submit guard
    setError(null);

    if (!name.trim()) return setError(t("err.enterName"));
    if (!isVerified) {
      return setError(`${t("err.verifyFirst")} · ${t("err.verifyFirstZh")}`);
    }
    if (!time || slots.length === 0) {
      return setError(t("err.choosePickup"));
    }

    setSubmitting(true);
    try {
      // One key for the life of this attempt, reused across retries, so a
      // double-tap or a flaky connection yields one order rather than two.
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      }

      const res = await fetch("/api/orders", {
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
          idempotencyKey: idempotencyKeyRef.current,
        }),
      });

      const data = (await res.json()) as
        | ({ ok: true } & LastOrder)
        | { ok: false; error: string; reason?: string };

      if (!res.ok || !data.ok) {
        // The server is the only authority on whether this browser is
        // verified. If it says no, our "✓ Number verified" badge is stale and
        // must go — showing it beside "Please verify your phone number" is the
        // contradiction that made this bug so hard to report. Keyed off the
        // machine-readable `reason`, never the bilingual prose.
        if (
          "reason" in data &&
          (data.reason === "phone_unverified" || data.reason === "phone_mismatch")
        ) {
          setVerifiedPhone(null);
          setVerify("idle");
          setCode("");
        }
        setError(("error" in data && data.error) || t("err.noPlaceOrder"));
        setSubmitting(false);
        return;
      }

      const last: LastOrder = {
        orderNumber: data.orderNumber,
        total: data.total,
        pickupTime: data.pickupTime,
        // Read off the cart before clear() empties it, two lines below.
        allergyNote: mentionsAllergy(
          lines.map((l) => l.specialInstructions),
        ),
      };
      try {
        sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify(last));
      } catch {
        /* non-fatal */
      }
      clear();
      router.push("/order/confirmation");
    } catch {
      setError(`${t("err.noPlaceOrder")} · ${t("err.noPlaceOrderZh")}`);
      setSubmitting(false);
    }
  }

  if (hydrated && detailedLines.length === 0) {
    return (
      <div className="container-wide flex flex-col items-center gap-3 py-24 text-center">
        <h1 className="font-display text-3xl text-lacquer">{t("checkout.emptyTitle")}</h1>
        <p className="text-ink/70">{t("checkout.emptyHint")}</p>
        <Link
          href="/menu#order"
          className="mt-2 inline-flex min-h-12 items-center rounded-lg bg-gold px-6 font-semibold text-ink hover:bg-gold-light"
        >
          {t("checkout.backToMenu")}
        </Link>
      </div>
    );
  }

  return (
    <div className="container-wide grid gap-10 py-10 lg:grid-cols-[1fr_360px]">
      {/* Left: forms */}
      <form onSubmit={handleSubmit} className="order-2 lg:order-1">
        <h1 className="font-display text-4xl text-lacquer">{t("checkout.title")}</h1>
        <p className="mt-2 text-sm uppercase tracking-[0.15em] text-ink/55">
          {t("checkout.pickupOnlyAt", { street: restaurant.address.street })}
        </p>
        <p className="mt-3 rounded-md border border-gold/40 bg-gold/5 px-4 py-3 text-sm text-ink/80">
          <span className="font-semibold text-ink">{t("checkout.payAtCounter")}</span>{" "}
          {t("checkout.noOnlinePayment")}
        </p>

        {/* Pickup details */}
        <fieldset className="mt-8">
          <legend className="font-display text-2xl text-ink">
            {t("checkout.pickupDetails")}
          </legend>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-ink/60">
                {t("checkout.name")}
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
                className="w-full rounded-sm border border-gold/50 bg-ivory px-3 py-3 text-ink outline-none focus:border-lacquer"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-ink/60">
                {t("checkout.mobile")}
              </span>
              <input
                ref={phoneRef}
                value={phone}
                onChange={onPhoneChange}
                required
                inputMode="tel"
                autoComplete="tel"
                maxLength={14}
                placeholder="(619) 555-0148"
                disabled={isVerified}
                className="w-full rounded-sm border border-gold/50 bg-ivory px-3 py-3 text-ink outline-none focus:border-lacquer disabled:opacity-70"
              />
            </label>
          </div>
          <label className="mt-4 block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-ink/60">
              {t("checkout.pickupTime")}
            </span>
            {slots.length > 0 ? (
              <select
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-sm border border-gold/50 bg-ivory px-3 py-3 text-ink outline-none focus:border-lacquer"
              >
                {slots.map((s) => (
                  <option key={s.value} value={s.value}>
                    {/* Suffixed so a screenshot of a test order is never
                        mistaken for a real one. Presentation only — the value
                        submitted is unchanged. */}
                    {testMode ? `${s.label} (test)` : s.label}
                  </option>
                ))}
              </select>
            ) : testMode ? (
              // Reachable only if the day has no window AND no ASAP, which
              // pickupSlots({asIfOpen}) does not currently produce. Kept so
              // this branch can never silently show the closed notice to a
              // session that was told gates are off.
              <p className="rounded-md border-2 border-lacquer bg-gold/30 px-3 py-3 text-sm font-semibold text-ink">
                TEST MODE · gates off. No pickup times could be generated for
                today.
              </p>
            ) : (
              <p className="rounded-md border border-lacquer/40 bg-lacquer/5 px-3 py-3 text-sm leading-relaxed text-lacquer">
                {closedNote ?? t("checkout.closedFallback")}
              </p>
            )}
            {testMode && slots.length > 0 && (
              <p className="mt-2 rounded-md border-2 border-lacquer bg-gold/30 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-ink">
                TEST MODE · gates off. These times are offered as if open
              </p>
            )}
          </label>
        </fieldset>

        {/* Phone verification */}
        <fieldset className="mt-8">
          <legend className="font-display text-2xl text-ink">
            {t("checkout.verifyLegend")}
          </legend>
          <p className="mb-3 mt-1 text-sm text-ink/60">
            {t("checkout.verifyWhy")}
          </p>

          {isVerified ? (
            <p className="flex items-center gap-2 rounded-md border border-gold bg-gold/10 px-4 py-3 text-sm font-semibold text-ink">
              <span aria-hidden="true">✓</span>
              {t("checkout.verified")} · {t("checkout.verifiedZh")}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={sendCode}
                disabled={verify === "sending" || verify === "checking"}
                className="min-h-12 self-start rounded-lg border-2 border-lacquer px-5 font-semibold text-lacquer transition-colors hover:bg-lacquer hover:text-ivory disabled:opacity-50"
              >
                {verify === "sending"
                  ? t("checkout.sending")
                  : verify === "sent"
                    ? t("checkout.resendCode")
                    : t("checkout.textMeCode")}
              </button>

              {verify !== "idle" && (
                <div className="flex flex-wrap items-end gap-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-ink/60">
                      {t("checkout.codeLabel")}
                    </span>
                    <input
                      value={code}
                      onChange={(e) =>
                        setCode(e.target.value.replace(/\D/g, "").slice(0, 10))
                      }
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      className="w-40 rounded-sm border border-gold/50 bg-ivory px-3 py-3 font-mono text-lg tracking-[0.3em] text-ink outline-none focus:border-lacquer"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={submitCode}
                    disabled={code.length < 4 || verify === "checking"}
                    className="min-h-12 rounded-lg bg-lacquer px-5 font-semibold text-ivory transition-colors hover:bg-lacquer-dark disabled:opacity-50"
                  >
                    {verify === "checking" ? t("checkout.checking") : t("checkout.verify")}
                  </button>
                </div>
              )}
            </div>
          )}
        </fieldset>

        {notice && (
          <p
            role="status"
            className="mt-6 rounded-md border border-gold/50 bg-gold/10 px-4 py-3 text-sm text-ink"
          >
            {notice}
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="mt-6 rounded-md border border-lacquer/40 bg-lacquer/5 px-4 py-3 text-sm font-medium text-lacquer"
          >
            {error}
          </p>
        )}

        {/* ALLERGIES, STATED WHERE THE ORDER IS COMMITTED.
            The brief asked for this "near the special-instructions area",
            and on this page there is no such area — notes are per item,
            typed back in the item sheet, which is where the matching line
            also sits. So on this screen it goes at the last moment a
            customer can still act on it: directly above the button that
            creates the order.

            The wording is load-bearing. An order note is a message to a
            cook that nobody reads until the ticket prints, and a customer
            who types "severe peanut allergy" into it has told no one. The
            line has to move them to the phone, not reassure them that
            they have already been heard. */}
        <p className="mt-6 rounded-md border border-lacquer/40 bg-lacquer/5 px-4 py-3 text-sm text-ink/80">
          <span className="font-semibold text-lacquer">
            {t("checkout.allergyWarn")}
          </span>{" "}
          <span lang="zh-Hant" className="font-chinese text-ink/75">
            · {t("checkout.allergyWarnZh")}
          </span>{" "}
          <PhoneLinks
            separator={` ${t("ui.or")} `}
            className="font-semibold text-lacquer underline underline-offset-2"
          />
        </p>

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-4 flex min-h-12 w-full items-center justify-center rounded-lg bg-gold px-6 font-semibold text-ink transition-colors hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting
            ? t("checkout.placing")
            : t("checkout.placeOrder", { total: formatCents(total) })}
        </button>
        <p className="mt-2 text-center text-xs uppercase tracking-[0.15em] text-ink/50">
          {t("checkout.payAtCounterShort")}
        </p>
      </form>

      {/* Right: order summary */}
      <aside className="order-1 h-max rounded-md border border-gold/40 bg-cream px-5 py-5 lg:order-2 lg:sticky lg:top-6">
        <h2 className="font-display text-2xl text-ink">{t("checkout.yourOrder")}</h2>
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
            <dt className="text-ink/70">{t("cart.subtotal")}</dt>
            <dd className="text-ink">{formatCents(subtotalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink/70">{t("cart.tax")}</dt>
            <dd className="text-ink">
              {taxRateBps != null ? formatCents(tax) : t("checkout.taxAtPickup")}
            </dd>
          </div>
          <div className="flex justify-between border-t border-gold/20 pt-1 text-base font-semibold">
            <dt className="text-ink">{t("checkout.dueAtPickup")}</dt>
            <dd className="text-lacquer">{formatCents(total)}</dd>
          </div>
        </dl>
        {/* 158x21 at 390 — the only way back into the cart from this page,
            and shorter than a thumb. `tap` takes the target to 44 without
            moving the summary card's last line. */}
        <Link
          href="/menu#order"
          className="tap mt-4 inline-block text-sm text-ink/60 underline underline-offset-2 hover:text-lacquer"
        >
          ← {t("checkout.editOrder")}
        </Link>
      </aside>
    </div>
  );
}
