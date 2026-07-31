"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/money";
import { formatPickupTime } from "@/lib/orders/businessDate";
import type { Order } from "@/lib/orders/types";
import { logoutAction } from "@/app/[kitchenSlug]/actions";
import KitchenOrderCard from "@/components/kitchen/KitchenOrderCard";

/**
 * The counter-tablet order board.
 *
 * Boring on purpose. Polling every 10s beats websockets here: there is no
 * reconnect logic to get wrong, no proxy that silently drops an idle socket,
 * and a missed poll self-heals ten seconds later. The kitchen needs reliable,
 * not clever.
 *
 * A new order announces itself — highlight plus a chime — because the tablet
 * lives across the room from whoever is cooking.
 */

const POLL_MS = 10_000;
const MUTE_KEY = "nmc-kitchen-muted";

interface KitchenBoardProps {
  timezone: string;
  businessDate: string;
  ordersConfigured: boolean;
  printingConfigured: boolean;
}

interface PrinterPayload {
  health: "ok" | "paper-out" | "cover-open" | "offline" | "unknown";
  secondsSinceSeen: number | null;
  statusCode: string | null;
  blocked: boolean;
  configured: boolean;
}

interface OrdersResponse {
  ok: boolean;
  orders?: Order[];
  printer?: PrinterPayload;
  error?: string;
}

/**
 * THE PRINTER STRIP — always on screen, above everything.
 *
 * The failure it exists for: paper runs out at 7pm, tickets stop, and the only
 * evidence anybody has is that the board looks normal and the kitchen has gone
 * quiet. Nobody thinks to check the roll for twenty minutes. One line at the
 * top of the screen turns that into a glance.
 *
 * Bilingual because the person who notices first is whoever is nearest the
 * tablet, and that is not reliably the person who reads English.
 */
function PrinterStrip({ printer }: { printer: PrinterPayload | null }) {
  // Before the first poll answers, and when no printer is configured at all —
  // that second case already has its own banner below and does not need a
  // second one contradicting it.
  if (!printer || !printer.configured) return null;

  const seen =
    printer.secondsSinceSeen === null
      ? null
      : printer.secondsSinceSeen < 90
        ? `${printer.secondsSinceSeen}s ago`
        : `${Math.round(printer.secondsSinceSeen / 60)} min ago`;

  const state = {
    ok: {
      dot: "🟢",
      text: "Printer OK",
      zh: "打印機正常",
      className: "border-gold/40 bg-gold/10 text-ivory/85",
      urgent: false,
    },
    "paper-out": {
      dot: "🟡",
      text: "PAPER OUT (printer reporting)",
      zh: "打印機缺紙",
      className: "border-gold bg-gold/25 text-ivory",
      urgent: true,
    },
    "cover-open": {
      dot: "🟡",
      text: "COVER OPEN (printer reporting)",
      zh: "打印機蓋未關",
      className: "border-gold bg-gold/25 text-ivory",
      urgent: true,
    },
    offline: {
      dot: "🔴",
      text: "PRINTER OFFLINE — no poll for over 60s",
      zh: "打印機離線",
      className: "border-lacquer bg-lacquer text-ivory",
      urgent: true,
    },
    unknown: {
      dot: "⚪",
      text: "Printer has not checked in yet",
      zh: "尚未連線",
      className: "border-ivory/30 bg-ivory/5 text-ivory/70",
      urgent: false,
    },
  }[printer.health];

  return (
    <div
      role={state.urgent ? "alert" : "status"}
      className={`mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-2 px-5 py-3 ${state.className} ${
        state.urgent ? "text-lg font-bold" : "text-base"
      }`}
    >
      <span>
        {state.dot} {state.text}
      </span>
      <span className="font-display text-xl">{state.zh}</span>
      {seen && <span className="text-sm font-normal opacity-70">last seen {seen}</span>}
      {state.urgent && printer.statusCode && (
        <span className="text-sm font-normal opacity-70">
          reported: {printer.statusCode}
        </span>
      )}
      {state.urgent && (
        <span className="text-sm font-normal opacity-80">
          Queued orders are waiting, not lost — they print when it recovers.
        </span>
      )}
    </div>
  );
}

/**
 * Two-tone chime via WebAudio. No audio asset to ship, cache, or 404 — and it
 * cannot be blocked by an adblocker the way a fetched file can.
 */
function useChime(muted: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);

  return useCallback(() => {
    if (muted) return;
    try {
      // Constructed lazily: browsers refuse an AudioContext until the page has
      // been interacted with, and staff always tap to log in first.
      ctxRef.current ??= new AudioContext();
      const ctx = ctxRef.current;
      void ctx.resume();

      for (const [index, freq] of [880, 1320].entries()) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const start = ctx.currentTime + index * 0.18;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.35);
      }
    } catch {
      /* audio unavailable — the visual highlight still fires */
    }
  }, [muted]);
}

export default function KitchenBoard({
  timezone,
  businessDate,
  ordersConfigured,
  printingConfigured,
}: KitchenBoardProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  /**
   * Result of a staff action, kept SEPARATE from `error`.
   *
   * They were one state at first, and the refresh that follows an action
   * cleared the message before anyone could read it — tapping 重印 with no
   * printer configured looked like it had silently worked. Connection health
   * and action feedback have different lifetimes, so they get different state.
   */
  const [notice, setNotice] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());
  const [printer, setPrinter] = useState<PrinterPayload | null>(null);

  // Ids seen in a previous poll. Seeded on the first poll so a page refresh
  // mid-service does not chime for every order already on the board.
  const seenRef = useRef<Set<number> | null>(null);
  const chime = useChime(muted);

  // Read the persisted mute preference after mount. The server render and the
  // first client render both assume "audible", and we flip afterwards — the
  // same hydration-safe pattern the cart uses. Reading storage in a useState
  // initializer would instead produce an SSR/client mismatch.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMuted(localStorage.getItem(MUTE_KEY) === "1");
    } catch {
      /* storage unavailable — default to audible */
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      } catch {
        /* non-fatal */
      }
      return next;
    });
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/kitchen/orders?completed=${showCompleted ? "1" : "0"}`,
        { cache: "no-store" },
      );
      if (res.status === 401) {
        // Session expired mid-shift. A reload lands on the login screen.
        window.location.reload();
        return;
      }
      const data = (await res.json()) as OrdersResponse;
      if (!data.ok) {
        setError(data.error ?? "Could not load orders.");
        return;
      }

      const next = data.orders ?? [];
      const seen = seenRef.current;
      if (seen === null) {
        // First poll of this session: adopt without announcing.
        seenRef.current = new Set(next.map((o) => o.id));
      } else {
        const arrivals = next.filter((o) => !seen.has(o.id));
        if (arrivals.length > 0) {
          chime();
          setFreshIds(new Set(arrivals.map((o) => o.id)));
          // The highlight is a nudge, not a state — clear it so a card that
          // has been on screen for a minute stops shouting.
          setTimeout(() => setFreshIds(new Set()), 20_000);
        }
        seenRef.current = new Set(next.map((o) => o.id));
      }

      setOrders(next);
      setPrinter(data.printer ?? null);
      setError(null);
      setLastSync(new Date());
    } catch {
      setError("Lost connection to the server. Retrying…");
    }
  }, [showCompleted, chime]);

  // Subscribe to the server: an immediate fetch so the board is populated on
  // arrival, then every POLL_MS. This is the rule's intended shape — polling
  // an external system and setting state from the response — but the linter
  // cannot see that `poll` only calls setState in a promise continuation, well
  // after the effect body has returned.
  useEffect(() => {
    if (!ordersConfigured) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(id);
  }, [poll, ordersConfigured]);

  const act = useCallback(
    async (orderId: number, action: string) => {
      setNotice(null);
      try {
        const res = await fetch(`/api/kitchen/orders/${orderId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = (await res.json()) as { ok: boolean; error?: string };
        if (!data.ok) {
          setNotice(data.error ?? "That action did not go through.");
        }
      } catch {
        setNotice("That action did not reach the server. Please try again.");
      }
      // Refresh regardless: even a failed reprint may have changed the row.
      await poll();
    },
    [poll],
  );

  // Action feedback is transient — long enough to read across the line, short
  // enough that a stale message is never mistaken for the current state.
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 12_000);
    return () => clearTimeout(id);
  }, [notice]);

  const failedCount = orders.filter((o) => o.status === "PRINT_FAILED").length;

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 pb-16 pt-4">
      {/* ---------------- header ---------------- */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-gold/40 pb-3">
        <div className="flex items-baseline gap-4">
          <h1 className="font-display text-3xl text-gold">今日訂單</h1>
          <span className="text-lg text-ivory/70">{businessDate}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ivory/50">
            {lastSync
              ? `Updated ${lastSync.toLocaleTimeString("en-US", { timeStyle: "medium" })}`
              : "…"}
          </span>
          <button
            onClick={toggleMute}
            aria-pressed={muted}
            className="min-h-11 border-2 border-gold/50 px-4 font-semibold text-ivory transition-colors hover:border-gold"
          >
            {muted ? "🔕 Muted" : "🔔 Sound on"}
          </button>
          <button
            onClick={() => setShowCompleted((v) => !v)}
            aria-pressed={showCompleted}
            className={`min-h-11 border-2 px-4 font-semibold transition-colors ${
              showCompleted
                ? "border-gold bg-gold text-ink"
                : "border-gold/50 text-ivory hover:border-gold"
            }`}
          >
            {showCompleted ? "全部 All" : "未完成 Active"}
          </button>
          <form action={logoutAction}>
            <button
              type="submit"
              className="min-h-11 border-2 border-ivory/30 px-4 font-semibold text-ivory/70 transition-colors hover:border-ivory/60"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {/* ---------------- printer health ---------------- */}
      {/* First thing under the header, before the queue: when nothing is
          printing, this is the answer, and it should not be below the fold. */}
      <PrinterStrip printer={printer} />

      {/* ---------------- operator banners ---------------- */}
      {!ordersConfigured && (
        <p className="mt-4 border-2 border-lacquer bg-lacquer/25 px-5 py-4 text-lg font-semibold">
          The order database is not configured. Set{" "}
          <code className="text-gold">DATABASE_URL</code> — no orders can be
          stored or shown until you do.
        </p>
      )}

      {!printingConfigured && ordersConfigured && (
        <p className="mt-4 border-2 border-gold/40 bg-gold/10 px-5 py-3 text-base text-ivory/85">
          No printer configured — this board is the only copy of every order.
          That is a supported setup, not an error.
        </p>
      )}

      {failedCount > 0 && (
        <p className="mt-4 animate-pulse border-4 border-lacquer bg-lacquer px-5 py-4 text-xl font-bold text-ivory">
          ⚠ {failedCount} order{failedCount > 1 ? "s" : ""} did not print — read
          them here and hand-write if needed. 未印出，請在此查看。
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 border-2 border-lacquer bg-lacquer/25 px-5 py-3 text-base font-semibold"
        >
          {error}
        </p>
      )}

      {notice && (
        <div
          role="status"
          className="mt-4 flex items-center justify-between gap-4 border-2 border-gold bg-gold/15 px-5 py-3 text-base font-semibold text-ivory"
        >
          <span>{notice}</span>
          <button
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            className="min-h-11 px-3 text-2xl leading-none text-ivory/70 hover:text-ivory"
          >
            ×
          </button>
        </div>
      )}

      {/* ---------------- the queue ---------------- */}
      {ordersConfigured && orders.length === 0 && !error && (
        <p className="mt-16 text-center text-2xl text-ivory/45">
          No orders yet today. · 今日暫無訂單。
        </p>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {orders.map((order) => (
          <KitchenOrderCard
            key={order.id}
            order={order}
            timezone={timezone}
            fresh={freshIds.has(order.id)}
            // A QUEUED order under a dead printer is WAITING, not stuck. The
            // distinction matters at the pass: one means "do nothing, it will
            // print", the other means "go and read this card out loud".
            waitingForPrinter={printer?.blocked === true}
            onAction={act}
          />
        ))}
      </div>

      {/* Running total, so the owner can sanity-check the day at a glance. */}
      {orders.length > 0 && (
        <p className="mt-8 text-right text-lg text-ivory/60">
          {orders.length} order{orders.length > 1 ? "s" : ""} ·{" "}
          {formatCents(
            orders.reduce((n, o) => n + o.totals.totalCents, 0),
          )}{" "}
          · pickup times shown in{" "}
          {formatPickupTime(new Date().toISOString(), timezone)} local
        </p>
      )}
    </main>
  );
}
