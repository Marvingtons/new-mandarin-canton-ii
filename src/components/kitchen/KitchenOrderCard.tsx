"use client";

import { useState } from "react";
import { formatCents } from "@/lib/money";
import { formatPickupTime } from "@/lib/orders/businessDate";
import type { Order, OrderStatus } from "@/lib/orders/types";

/**
 * One order, sized to be read across a hot line.
 *
 * 中文 leads on every line, exactly as the printed ticket does — staff should
 * not have to re-learn the layout when they switch from paper to the tablet.
 * Anything without 中文 carries the same ⚠ EN marker the ticket prints, so a
 * translation gap looks identical in both places.
 */

const STATUS_LABEL: Record<OrderStatus, string> = {
  QUEUED: "待列印 WAITING TO PRINT",
  PRINTED: "已印 PRINTED",
  PRINT_FAILED: "未印出 NOT PRINTED",
  ACCEPTED: "製作中 COOKING",
  COMPLETED: "已完成 DONE",
  CANCELLED: "已取消 CANCELLED",
};

export default function KitchenOrderCard({
  order,
  timezone,
  fresh,
  onAction,
}: {
  order: Order;
  timezone: string;
  fresh: boolean;
  onAction: (orderId: number, action: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showTicket, setShowTicket] = useState(false);

  const failed = order.status === "PRINT_FAILED";
  // A QUEUED order the printer has already been handed (attempts > 0) and not
  // confirmed is the quiet failure mode: paper may never have come out.
  const stale = order.status === "QUEUED" && order.printAttempts > 0;
  const done = order.status === "COMPLETED" || order.status === "CANCELLED";

  async function run(action: string) {
    setBusy(action);
    try {
      await onAction(order.id, action);
    } finally {
      setBusy(null);
    }
  }

  return (
    <article
      className={`flex flex-col border-4 bg-ink/60 ${
        failed
          ? "border-lacquer"
          : fresh
            ? "border-gold shadow-[0_0_0_6px_rgba(201,162,77,0.25)]"
            : done
              ? "border-ivory/15"
              : "border-gold/40"
      } ${done ? "opacity-55" : ""}`}
    >
      {/* header: number + pickup time, the two things read first */}
      <div className="flex items-start justify-between gap-3 border-b-2 border-gold/30 px-4 py-3">
        <div>
          <div className="font-display text-5xl leading-none text-gold">
            {order.orderNumber}
          </div>
          <div className="mt-1 text-sm uppercase tracking-[0.12em] text-ivory/55">
            {STATUS_LABEL[order.status]}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-[0.12em] text-ivory/55">
            取餐 PICKUP
          </div>
          <div className="text-3xl font-bold text-ivory">
            {formatPickupTime(order.pickupAt, timezone)}
          </div>
        </div>
      </div>

      {failed && (
        <div className="bg-lacquer px-4 py-2 text-base font-bold text-ivory">
          ⚠ 未印出 — this ticket never printed
          {order.lastPrintError ? ` (${order.lastPrintError})` : ""}
        </div>
      )}

      {stale && (
        <div className="bg-lacquer px-4 py-2 text-base font-bold text-ivory">
          ⚠ 未確認 — sent to the printer {order.printAttempts}× with no
          confirmation. Check the paper.
        </div>
      )}

      {/* items */}
      <ul className="flex-1 divide-y divide-gold/15 px-4">
        {order.items.map((line, index) => (
          <li key={`${line.itemId}-${index}`} className="py-3">
            <div className="flex items-baseline gap-3">
              <span className="min-w-12 bg-gold px-2 text-center text-2xl font-bold text-ink">
                ×{line.quantity}
              </span>
              <span className="text-3xl font-bold leading-tight text-ivory">
                {line.nameZh ?? line.nameEn}
                {!line.nameZh && (
                  <span className="ml-2 text-base font-bold text-gold">
                    ⚠ EN
                  </span>
                )}
              </span>
            </div>

            {line.nameZh && (
              <div className="ml-15 pl-1 text-base text-ivory/60">
                {line.nameEn}
              </div>
            )}

            {line.sizeLabel.toLowerCase() !== "regular" && (
              <div className="ml-15 pl-1 text-xl font-semibold text-gold-light">
                {line.sizeLabelZh ?? line.sizeLabel}
                {!line.sizeLabelZh && " ⚠ EN"}
              </div>
            )}

            {line.modifiers.length > 0 && (
              <ul className="ml-15 pl-1">
                {line.modifiers.map((mod) => (
                  <li key={mod.id} className="text-xl text-ivory/85">
                    ● {mod.nameZh ?? mod.nameEn}
                    {!mod.nameZh && " ⚠ EN"}
                  </li>
                ))}
              </ul>
            )}

            {line.specialInstructions && (
              <div className="ml-15 mt-2 border-2 border-gold px-3 py-2">
                <div className="text-xs font-bold uppercase tracking-[0.12em] text-gold">
                  備註 NOTE
                </div>
                <div className="text-xl text-ivory">
                  {line.specialInstructions}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* customer + total */}
      <div className="border-t-2 border-gold/30 px-4 py-3 text-lg">
        <div className="font-semibold text-ivory">
          客人 {order.customer.name}
        </div>
        <a
          href={`tel:${order.customer.phone.replace(/\D/g, "")}`}
          className="text-gold underline underline-offset-4"
        >
          電話 {order.customer.phone}
        </a>
        <div className="mt-1 text-ivory/70">
          合計 {formatCents(order.totals.totalCents)} · 到店付款 PAY AT COUNTER
        </div>
      </div>

      {/* actions */}
      <div className="flex flex-wrap gap-2 border-t-2 border-gold/30 p-3">
        {order.status !== "ACCEPTED" && !done && (
          <button
            onClick={() => run("accept")}
            disabled={busy !== null}
            className="min-h-14 flex-1 bg-gold px-4 text-2xl font-bold text-ink transition-colors hover:bg-gold-light disabled:opacity-50"
          >
            {busy === "accept" ? "…" : "接單"}
          </button>
        )}
        {!done && (
          <button
            onClick={() => run("complete")}
            disabled={busy !== null}
            className="min-h-14 flex-1 border-2 border-gold px-4 text-2xl font-bold text-gold transition-colors hover:bg-gold hover:text-ink disabled:opacity-50"
          >
            {busy === "complete" ? "…" : "完成"}
          </button>
        )}
        <button
          onClick={() => run("reprint")}
          disabled={busy !== null}
          className="min-h-14 border-2 border-ivory/30 px-4 text-xl font-semibold text-ivory/80 transition-colors hover:border-ivory/70 disabled:opacity-50"
        >
          {busy === "reprint" ? "…" : "重印"}
        </button>
        <button
          onClick={() => setShowTicket((v) => !v)}
          className="min-h-14 border-2 border-ivory/30 px-4 text-xl font-semibold text-ivory/80 transition-colors hover:border-ivory/70"
        >
          {showTicket ? "收起" : "單據"}
        </button>
      </div>

      {/* The exact image that goes to the printer — the fallback that makes a
          dead printer survivable. */}
      {showTicket && (
        <div className="border-t-2 border-gold/30 bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- server-rendered PNG of unknown height, not a static asset */}
          <img
            src={`/api/kitchen/orders/${order.id}/ticket`}
            alt={`Kitchen ticket for ${order.orderNumber}`}
            className="mx-auto w-full max-w-[576px]"
          />
        </div>
      )}
    </article>
  );
}
