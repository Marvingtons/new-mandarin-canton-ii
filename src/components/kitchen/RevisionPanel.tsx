"use client";

import { useEffect, useState } from "react";
import { formatCents } from "@/lib/money";
import { formatPickupTime } from "@/lib/orders/businessDate";
import type { OrderLine, OrderTotals } from "@/lib/orders/types";
import type { OrderLinesDiff } from "@/lib/orders/revisionDiff";
import Icon from "@/components/kitchen/Icon";
import { useKT } from "@/components/kitchen/KitchenI18n";
import EditDiffList from "@/components/kitchen/EditDiffList";

/**
 * 修改紀錄 EDIT HISTORY on a History card of an edited order: each saved
 * edit, newest first, with its time, the total before and after, and what it
 * changed in the change ticket's own words; the order as placed last.
 * Loaded from /revisions the first time it is opened.
 */

interface RevisionsView {
  ok: boolean;
  edits: { revision: number; savedAt: string; diff: OrderLinesDiff; totalBeforeCents: number; totalAfterCents: number }[];
  original: { items: OrderLine[]; totals: OrderTotals; placedAt: string };
}

export default function RevisionPanel({
  orderId,
  revision,
  timezone,
}: {
  orderId: number;
  revision: number;
  timezone: string;
}) {
  const t = useKT();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<RevisionsView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/kitchen/orders/${orderId}/revisions`, { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<RevisionsView>) : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        setView(data);
        setFailed(false);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name !== "AbortError") setFailed(true);
      });
    return () => controller.abort();
  }, [open, orderId, revision]);

  return (
    <section data-revisions className="mx-5 mb-3 rounded-staff-control bg-staff-bg px-4 py-1 shadow-[inset_0_0_0_2px_var(--color-staff-line-strong)]">
      <button
        type="button"
        aria-expanded={open}
        data-action="toggle-revisions"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full items-center justify-between gap-3 text-left text-staff-body font-bold"
      >
        <span>
          {t("history.revisions")} <span className="font-normal text-staff-soft">{t("card.edited", { n: revision })}</span>
        </span>
        <Icon name="chevronDown" size={20} className={open ? "rotate-180" : ""} />
      </button>
      {open && !view && !failed && <p className="pb-3 text-staff-caption text-staff-soft">{t("common.loading")}</p>}
      {open && failed && <p role="alert" className="pb-3 text-staff-caption text-staff-brand">{t("history.revisionsError")}</p>}
      {open && view && (
        <div className="pb-3">
          {view.edits.map((edit) => (
            <div key={edit.revision} data-revision-entry={edit.revision} className="border-t border-staff-line py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-staff-body font-bold">{t("history.revision", { n: edit.revision })}</span>
                <span className="text-staff-caption text-staff-soft">
                  {t("history.revisionMeta", {
                    time: formatPickupTime(edit.savedAt, timezone),
                    before: formatCents(edit.totalBeforeCents),
                    after: formatCents(edit.totalAfterCents),
                  })}
                </span>
              </div>
              <EditDiffList diff={edit.diff} compact />
            </div>
          ))}
          <p className="border-t border-staff-line pt-2 text-staff-caption text-staff-soft">
            {t("history.original", {
              time: formatPickupTime(view.original.placedAt, timezone),
              total: formatCents(view.original.totals.totalCents),
              n: view.original.items.reduce((n, l) => n + l.quantity, 0),
            })}
          </p>
        </div>
      )}
    </section>
  );
}
