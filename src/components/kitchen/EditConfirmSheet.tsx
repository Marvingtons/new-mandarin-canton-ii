"use client";

import { formatCents } from "@/lib/money";
import type { OrderLinesDiff } from "@/lib/orders/revisionDiff";
import { useKT } from "@/components/kitchen/KitchenI18n";
import Button from "@/components/kitchen/ui/Button";
import { Dialog } from "@/components/kitchen/ui/Dialog";
import EditDiffList from "@/components/kitchen/EditDiffList";
import ui from "@/components/kitchen/ui/ui.module.css";

/**
 * 確認改單: before an edit is saved, exactly what the kitchen will receive.
 * Everything on it comes from the server's dry run (POST …/edit with
 * dryRun), so the blocks and the totals are the server's, not the tablet's
 * estimate. What prints depends on the order: a change ticket, nothing extra
 * (never printed yet: the first ticket carries the new contents), or, for a
 * done order, nothing unless staff turn "Print a change ticket" on.
 */

export interface EditPreview {
  diff: OrderLinesDiff;
  oldTotalCents: number;
  newTotalCents: number;
  print: "change" | "replace" | "none";
}

export default function EditConfirmSheet({
  orderNumber,
  preview,
  web,
  done,
  printChange,
  onPrintChange,
  saving,
  error,
  reopen = false,
  onConfirm,
  onClose,
}: {
  orderNumber: string;
  /** Null while the dry run is in flight. */
  preview: EditPreview | null;
  /** A web order: the customer was quoted a total online. */
  web: boolean;
  /** A COMPLETED order: printing the change ticket is opt-in. */
  done: boolean;
  printChange: boolean;
  onPrintChange: (value: boolean) => void;
  saving: boolean;
  error: string | null;
  /** Another tablet saved first: the primary button reloads the order instead. */
  reopen?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useKT();
  const print = preview ? (done && printChange && preview.print === "none" ? "change" : preview.print) : null;
  return (
    <Dialog title={t("edit.confirm.title", { number: orderNumber })} onClose={onClose}>
      <div data-sheet="edit-confirm" className="flex flex-col gap-3">
        {!preview && <p className={ui.dialogText}>{t("edit.confirm.checking")}</p>}
        {preview && (
          <>
            <p className={ui.dialogText}>
              {print === "change" ? t("edit.confirm.change") : print === "replace" ? t("edit.confirm.replace") : t("edit.confirm.none")}
            </p>
            {done && (
              <label className="flex min-h-12 items-center gap-3 text-staff-body font-semibold">
                <input
                  type="checkbox"
                  data-action="print-change"
                  checked={printChange}
                  onChange={(e) => onPrintChange(e.target.checked)}
                  className="size-6 accent-staff-brand"
                />
                {t("edit.confirm.printChange")}
              </label>
            )}
            <div className="max-h-[42vh] overflow-y-auto">
              <EditDiffList diff={preview.diff} />
            </div>
            <div data-edit-total className="flex items-baseline justify-between gap-4 rounded-staff-control bg-staff-bg px-4 py-3">
              <span className="text-staff-body">{t("edit.confirm.total")}</span>
              <span className="whitespace-nowrap">
                <span className="text-staff-body text-staff-soft line-through">{formatCents(preview.oldTotalCents)}</span>
                <span className="text-staff-body"> → </span>
                <span className="text-staff-title font-bold" data-new-total>
                  {formatCents(preview.newTotalCents)}
                </span>
              </span>
            </div>
            {web && preview.oldTotalCents !== preview.newTotalCents && (
              <p className="text-staff-caption font-semibold">
                {t("edit.confirm.web", { old: formatCents(preview.oldTotalCents), new: formatCents(preview.newTotalCents) })}
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-staff-body font-semibold text-staff-brand">
            {error}
          </p>
        )}
        <div className={ui.dialogActions}>
          <Button variant="secondary" onClick={onClose}>
            {t("edit.confirm.keep")}
          </Button>
          {reopen ? (
            <Button variant="primary" data-action="reopen-edit" onClick={onConfirm}>
              {t("edit.reopen")}
            </Button>
          ) : (
            <Button variant="primary" data-action="confirm-edit" disabled={!preview || saving} busy={saving} onClick={onConfirm}>
              {saving ? t("edit.saving") : `${t("edit.saveZh")} ${t("edit.saveEn")}`}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
