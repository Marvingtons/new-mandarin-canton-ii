"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/money";
import type { Order } from "@/lib/orders/types";
import { useKT } from "@/components/kitchen/KitchenI18n";
import KitchenOrderCard, { type CardAction } from "@/components/kitchen/KitchenOrderCard";
import Icon from "@/components/kitchen/Icon";
import type { KitchenKey } from "@/lib/kitchen/i18n";
import type { PrinterHealth } from "@/lib/print/printerStatus";
import {
  channelWaiting,
  type BoardPrintersPayload,
} from "@/lib/print/printerPayload";
import { useKitchenChrome } from "@/components/kitchen/kitchenChrome";

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

interface OrdersResponse extends Partial<BoardPrintersPayload> {
  ok: boolean;
  orders?: Order[];
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
 * One entry per active printer since migration 011, each NAMED, because "the
 * printer is offline" no longer says which station has stopped. A down printer
 * whose tickets another printer is carrying says so: nothing is waiting, the
 * tickets just come out somewhere else marked 轉印 REROUTED.
 */
const PRINTER_STATE: Record<
  PrinterHealth,
  { label: KitchenKey; dot: string; className: string; urgent: boolean }
> = {
  ok: { label: "printer.state.ok", dot: "bg-staff-accent", className: "", urgent: false },
  "paper-out": { label: "printer.state.paperOut", dot: "bg-staff-warn", className: "bg-staff-warn-tint text-staff-warn", urgent: true },
  "cover-open": { label: "printer.state.coverOpen", dot: "bg-staff-warn", className: "bg-staff-warn-tint text-staff-warn", urgent: true },
  offline: { label: "printer.state.offline", dot: "bg-white", className: "bg-staff-danger text-white", urgent: true },
  unknown: { label: "printer.state.unknown", dot: "bg-staff-line-strong", className: "", urgent: false },
};

function seenText(t: ReturnType<typeof useKT>, seconds: number | null): string | null {
  if (seconds === null) return null;
  return seconds < 90
    ? t("printer.secondsAgo", { n: seconds })
    : t("printer.minutesAgo", { n: Math.round(seconds / 60) });
}

/**
 * Healthy: a quiet chip per printer in the header ("the printer is fine"
 * needs no more than a dot). Unhealthy: a full-width bar under it, the first
 * thing on the screen, because that is when it is the answer to "why is
 * nothing printing". Rendered twice with a `placement`; each placement draws
 * only its own cases.
 */
function PrinterStrip({
  printing,
  placement,
}: {
  printing: BoardPrintersPayload | null;
  placement: "header" | "banner";
}) {
  const t = useKT();
  // Before the first poll answers, and when no printer is configured at all —
  // that second case already has its own banner below.
  if (!printing || !printing.printer.configured) return null;

  // Configured, but no printer has ever polled: the single "not connected
  // yet" chip the board has always shown.
  if (printing.printers.length === 0) {
    if (placement !== "header") return null;
    return (
      <span role="status" className="inline-flex min-h-12 items-center gap-2 rounded-full border border-staff-line bg-staff-panel px-3 text-base text-staff-soft">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-staff-line-strong" />
        {t("printer.unknown")}
      </span>
    );
  }

  return (
    <>
      {printing.printers.map((p) => {
        const state = PRINTER_STATE[p.health];
        if ((placement === "banner") !== state.urgent) return null;
        const seen = seenText(t, p.secondsSinceSeen);

        if (!state.urgent) {
          return (
            <span key={p.id} role="status" data-printer-chip={p.role} className="inline-flex min-h-12 items-center gap-2 rounded-full border border-staff-line bg-staff-panel px-3 text-base text-staff-soft">
              <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${state.dot}`} />
              {t("printer.named", { name: p.label, state: t(state.label) })}
              {seen && <span className="text-staff-faint">· {t("printer.lastSeen", { ago: seen })}</span>}
            </span>
          );
        }

        return (
          <div key={p.id} role="alert" className={`mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-5 py-3.5 ${state.className}`}>
            <span className="flex items-center gap-2 text-lg font-semibold">
              <Icon name="printer" size={22} />
              {t("printer.named", { name: p.label, state: t(state.label) })}
            </span>
            {seen && <span className="text-base opacity-85">{t("printer.lastSeen", { ago: seen })}</span>}
            {p.statusCode && (
              <span className="text-base opacity-85">{t("printer.reported", { code: p.statusCode })}</span>
            )}
            <span className="w-full text-base opacity-90">
              {p.coveredBy ? t("printer.coveredBy", { other: p.coveredBy }) : t("printer.waitingNote")}
            </span>
          </div>
        );
      })}
    </>
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
  const t = useKT();
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
  const [printing, setPrinting] = useState<BoardPrintersPayload | null>(null);
  const { basePath } = useKitchenChrome();

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
        setError(t("board.errorLoad"));
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
      setPrinting(
        data.printer
          ? {
              printer: data.printer,
              printers: data.printers ?? [],
              routes: data.routes ?? {},
              unassignedRecent: data.unassignedRecent ?? 0,
            }
          : null,
      );
      setError(null);
      setLastSync(new Date());
    } catch {
      setError(t("board.errorConnection"));
    }
  }, [showCompleted, chime, t]);

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
    async (orderId: number, action: CardAction, extra?: { note?: string }) => {
      setNotice(null);
      try {
        const res = await fetch(`/api/kitchen/orders/${orderId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, ...(extra?.note ? { note: extra.note } : {}) }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          code?: string;
          order?: Order | null;
        };
        if (!data.ok) {
          setNotice(
            data.code === "cancelled"
              ? t("board.cancelledNoReprint")
              : data.code === "printing"
                ? t("board.printingNoReprint")
                : t("board.actionFailed"),
          );
        } else if (action === "reprint") {
          setNotice(t("board.requeued"));
        } else if (action === "cancel" && data.order) {
          setNotice(t("board.cancelled", { number: data.order.orderNumber }));
        }
      } catch {
        setNotice(t("board.actionUnreachable"));
      }
      // Refresh regardless: even a failed reprint may have changed the row.
      await poll();
    },
    [poll, t],
  );

  // Action feedback is transient — long enough to read across the line, short
  // enough that a stale message is never mistaken for the current state.
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 12_000);
    return () => clearTimeout(id);
  }, [notice]);

  const failedCount = orders.filter((o) => o.status === "PRINT_FAILED").length;
  // Every ticket with no confirmed print 2+ minutes into its current attempt.
  // Decided on the server (its clock, its fresh read), shown here first.
  const stuck = orders.filter((o) => o.printStuck === true);

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 pt-5 pb-16">
      {/* ---------------- header ---------------- */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{t("board.title")}</h1>
          <span className="text-base text-staff-faint">{businessDate}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PrinterStrip printing={printing} placement="header" />
          <span className="px-1 text-base text-staff-faint">
            {lastSync
              ? t("board.updated", {
                  time: lastSync.toLocaleTimeString("en-US", { timeStyle: "medium" }),
                })
              : t("common.busy")}
          </span>
          <button
            onClick={toggleMute}
            aria-pressed={muted}
            className="flex min-h-12 items-center gap-2 rounded-md border border-staff-line-strong bg-staff-panel px-4 text-base font-medium text-staff-ink transition-colors hover:bg-staff-sunken"
          >
            <Icon name={muted ? "bellOff" : "bell"} size={18} className={muted ? "text-staff-faint" : ""} />
            {muted ? t("board.muted") : t("board.soundOn")}
          </button>
          <div className="flex gap-1 rounded-lg bg-staff-sunken p-1">
            {[false, true].map((all) => (
              <button
                key={String(all)}
                onClick={() => setShowCompleted(all)}
                aria-pressed={showCompleted === all}
                className={`min-h-12 rounded-md px-4 text-base font-semibold transition-colors ${
                  showCompleted === all
                    ? "bg-staff-panel text-staff-ink shadow-[0_1px_2px_rgba(27,26,23,0.12)]"
                    : "text-staff-soft hover:text-staff-ink"
                }`}
              >
                {all ? t("board.showAll") : t("board.showActive")}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ---------------- printer health ---------------- */}
      {/* Only when something is wrong, and then first, above the queue. */}
      <PrinterStrip printing={printing} placement="banner" />

      {printing && printing.unassignedRecent > 0 && (
        <a
          href={`${basePath}/printers`}
          data-unassigned-printers
          className="mt-4 flex min-h-12 items-center gap-2 rounded-lg border border-staff-line bg-staff-panel px-5 py-3 text-base text-staff-soft hover:bg-staff-sunken"
        >
          <Icon name="printer" size={20} />
          {t("printer.unassigned", { n: printing.unassignedRecent })}
        </a>
      )}

      {/* ---------------- operator banners ---------------- */}
      {!ordersConfigured && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-staff-danger-tint px-5 py-3.5 text-base font-medium text-staff-danger">
          <Icon name="alert" size={20} className="mt-0.5" />
          {t("board.dbMissing")}
        </p>
      )}

      {!printingConfigured && ordersConfigured && (
        <p className="mt-4 rounded-lg border border-staff-line bg-staff-panel px-5 py-3 text-base text-staff-soft">
          {t("board.noPrinter")}
        </p>
      )}

      {stuck.length > 0 && (
        <div role="alert" className="mt-4 flex flex-col gap-2">
          {stuck.map((o) => (
            <div
              key={o.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-staff-danger py-2 pr-2 pl-5 text-white"
            >
              <span className="flex items-center gap-3 text-lg font-semibold">
                <Icon name="alert" size={22} />
                {t("board.stuckBanner", { number: o.orderNumber })}
              </span>
              <button
                onClick={() => void act(o.id, "reprint")}
                className="flex min-h-14 items-center gap-2 rounded-md bg-white px-5 text-lg font-semibold text-staff-danger hover:bg-white/90"
              >
                <Icon name="printer" size={20} />
                {t("card.reprint")}
              </button>
            </div>
          ))}
        </div>
      )}

      {failedCount > 0 && (
        <p className="mt-4 flex items-center gap-3 rounded-lg bg-staff-danger px-5 py-3.5 text-lg font-semibold text-white">
          <Icon name="alert" size={22} />
          {t("board.failedBanner", { n: failedCount })}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg bg-staff-danger-tint px-5 py-3 text-base font-medium text-staff-danger"
        >
          <Icon name="alert" size={20} className="mt-0.5" />
          {error}
        </p>
      )}

      {notice && (
        <div
          role="status"
          className="mt-4 flex items-center justify-between gap-4 rounded-lg bg-staff-ink py-2 pr-2 pl-5 text-base font-medium text-white"
        >
          <span>{notice}</span>
          <button
            onClick={() => setNotice(null)}
            aria-label={t("common.dismiss")}
            className="flex h-12 w-12 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
          >
            <Icon name="x" size={20} />
          </button>
        </div>
      )}

      {/* ---------------- the queue ---------------- */}
      {ordersConfigured && orders.length === 0 && !error && (
        <div className="mt-20 flex flex-col items-center gap-3 text-staff-faint">
          <Icon name="receipt" size={40} className="text-staff-line-strong" />
          <p className="text-xl">{t("board.empty")}</p>
        </div>
      )}

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {orders.map((order) => (
          <KitchenOrderCard
            key={order.id}
            order={order}
            timezone={timezone}
            fresh={freshIds.has(order.id)}
            // A QUEUED order under a dead printer is WAITING, not stuck. The
            // distinction matters at the pass: one means "do nothing, it will
            // print", the other means "go and read this card out loud".
            // Since 011: waiting only if THIS order's printer is down and no
            // other printer is carrying its tickets.
            waitingForPrinter={channelWaiting(printing, order.channel)}
            onAction={act}
          />
        ))}
      </div>

      {/* Running total, so the owner can sanity-check the day at a glance.
          Cancelled orders are not money. */}
      {orders.length > 0 && (
        <p className="mt-8 text-right text-base text-staff-faint">
          {t("board.footer", {
            n: orders.filter((o) => o.status !== "CANCELLED").length,
            total: formatCents(
              orders
                .filter((o) => o.status !== "CANCELLED")
                .reduce((n, o) => n + o.totals.totalCents, 0),
            ),
          })}
        </p>
      )}
    </main>
  );
}
