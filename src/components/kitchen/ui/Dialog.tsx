"use client";

import { useEffect, useId, useRef } from "react";
import Button from "@/components/kitchen/ui/Button";
import { useKT } from "@/components/kitchen/KitchenI18n";
import ui from "@/components/kitchen/ui/ui.module.css";

/**
 * A modal, on the native <dialog>: the browser traps focus, Escape closes it,
 * the page behind is inert, and focus returns to whatever opened it. Opened
 * on mount, so a caller renders it conditionally and unmounts it to close.
 */
export function Dialog({
  title,
  onClose,
  children,
  labelledBy,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      opener?.focus?.();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy ?? titleId}
      className={ui.dialog}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className={ui.dialogBody}>
        <h2 id={titleId} className={ui.dialogTitle}>
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}

/**
 * The confirm step every destructive action takes (cancel an order, clear a
 * table), and nothing else does. The safe choice comes first in the DOM, so
 * it is what the dialog focuses: Enter on a stray keypress goes back.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  /** Extra fields, e.g. a cancel reason. */
  children?: React.ReactNode;
}) {
  const t = useKT();
  return (
    <Dialog title={title} onClose={onClose}>
      <p className={ui.dialogText}>{body}</p>
      {children}
      <form
        method="dialog"
        className={ui.dialogActions}
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm();
        }}
      >
        <Button variant="secondary" onClick={onClose}>
          {t("confirm.keep")}
        </Button>
        <Button type="submit" variant="dangerSolid">
          {confirmLabel}
        </Button>
      </form>
    </Dialog>
  );
}
