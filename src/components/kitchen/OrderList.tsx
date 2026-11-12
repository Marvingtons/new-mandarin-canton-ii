"use client";

import { useCallback, useState } from "react";
import type { Station } from "@/config/stations";
import type { Order } from "@/lib/orders/types";
import { useKT } from "@/components/kitchen/KitchenI18n";
import { useKitchenLive } from "@/components/kitchen/KitchenLive";
import OrderCard, { type CardRequest } from "@/components/kitchen/OrderCard";
import ReprintDialog from "@/components/kitchen/ReprintDialog";
import { ConfirmDialog } from "@/components/kitchen/ui/Dialog";
import { OrderCardSkeleton } from "@/components/kitchen/ui/Skeleton";
import { useShortcuts } from "@/components/kitchen/ui/shortcuts";

/**
 * A grid of OrderCards, and the one place an action on an order is carried
 * out: the live act/clearTable (optimistic, with rollback), the reprint
 * station picker, and the confirm step for the two destructive actions
 * (cancel, clear table). The board and history both render this, so an
 * action behaves the same whichever screen, and whichever station.
 *
 * Keyboard (board only): J/K or the arrows move the selection, A accept,
 * C complete, P reprint, X cancel. A selected card is ringed in lacquer.
 */

type Pending = { kind: "reprint" | "cancel" | "clearTable"; order: Order } | null;

export default function OrderList({
  orders,
  timezone,
  variant,
  loading = false,
  keyboard = false,
  waitingStations,
  onActed,
}: {
  orders: Order[];
  timezone: string;
  variant: "board" | "history";
  loading?: boolean;
  keyboard?: boolean;
  /** Stations whose printer is withholding or cannot collect tickets. */
  waitingStations?: ReadonlySet<Station>;
  /** After any action succeeds: history refetches its page. */
  onActed?: () => void;
}) {
  const t = useKT();
  const { act, clearTable, freshIds, pendingIds } = useKitchenLive();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<Pending>(null);
  const [cancelNote, setCancelNote] = useState("");

  const done = useCallback(
    (ok: boolean) => {
      if (ok) onActed?.();
    },
    [onActed],
  );

  const request = useCallback(
    (order: Order, kind: CardRequest) => {
      setSelectedId(order.id);
      if (kind === "accept" || kind === "complete") {
        void act(order, kind).then(done);
        return;
      }
      if (kind === "reprint" && order.status === "CANCELLED") return;
      if (kind === "cancel" && (order.status === "CANCELLED" || order.status === "COMPLETED")) return;
      if (kind === "clearTable" && !(order.channel === "dine_in" && order.tableLabel && order.tableClearedAt === null)) return;
      setCancelNote("");
      setDialog({ kind, order });
    },
    [act, done],
  );

  /* ---- keyboard ---- */
  const selected = orders.find((o) => o.id === selectedId) ?? null;
  const move = (delta: number) => {
    if (orders.length === 0) return;
    const index = selected ? orders.indexOf(selected) : -1;
    const next = orders[Math.max(0, Math.min(orders.length - 1, index + delta))];
    setSelectedId(next.id);
    const el = document.querySelector<HTMLElement>(`[data-order-id="${next.id}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const onSelected = (kind: CardRequest) => () => {
    if (!selected || pendingIds.has(selected.id)) return;
    const finished = selected.status === "COMPLETED" || selected.status === "CANCELLED";
    if ((kind === "accept" && (finished || selected.status === "ACCEPTED")) || (kind === "complete" && finished)) return;
    request(selected, kind);
  };
  useShortcuts(
    {
      j: () => move(1),
      k: () => move(-1),
      ArrowDown: () => move(1),
      ArrowUp: () => move(-1),
      a: onSelected("accept"),
      c: onSelected("complete"),
      p: onSelected("reprint"),
      x: onSelected("cancel"),
    },
    keyboard,
  );

  if (loading) {
    return (
      <div aria-busy="true" aria-label={t("common.loading")} className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <OrderCardSkeleton />
        <OrderCardSkeleton />
        <OrderCardSkeleton />
      </div>
    );
  }

  return (
    <>
      <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            timezone={timezone}
            variant={variant}
            fresh={freshIds.has(order.id)}
            selected={keyboard && order.id === selectedId}
            pending={pendingIds.has(order.id)}
            waitingForPrinter={waitingStations?.has(order.station) === true}
            onRequest={request}
            onSelect={setSelectedId}
          />
        ))}
      </div>

      {dialog?.kind === "reprint" && (
        <ReprintDialog
          order={dialog.order}
          onClose={() => setDialog(null)}
          onReprint={(station) => {
            const order = dialog.order;
            setDialog(null);
            void act(order, "reprint", { station }).then(done);
          }}
        />
      )}

      {dialog?.kind === "cancel" && (
        <ConfirmDialog
          title={t("card.cancelTitle", { number: dialog.order.orderNumber })}
          body={t("confirm.cancelBody")}
          confirmLabel={t("card.cancelConfirm")}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            const order = dialog.order;
            const note = cancelNote.trim() || undefined;
            setDialog(null);
            void act(order, "cancel", { note }).then(done);
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-staff-body text-staff-soft">{t("card.cancelReason")}</span>
            <input
              value={cancelNote}
              onChange={(e) => setCancelNote(e.target.value)}
              maxLength={300}
              className="min-h-14 rounded-staff-control bg-staff-panel px-3 text-staff-body shadow-[inset_0_0_0_1px_var(--color-staff-line-strong)] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-staff-brand)]"
            />
          </label>
        </ConfirmDialog>
      )}

      {dialog?.kind === "clearTable" && dialog.order.tableLabel && (
        <ConfirmDialog
          title={t("confirm.clearTitle", { table: dialog.order.tableLabel })}
          body={t("confirm.clearBody")}
          confirmLabel={t("confirm.clearConfirm")}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            const label = dialog.order.tableLabel!;
            setDialog(null);
            void clearTable(label).then(done);
          }}
        />
      )}
    </>
  );
}
