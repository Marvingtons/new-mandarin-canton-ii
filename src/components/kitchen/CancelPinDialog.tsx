"use client";

import { useEffect, useState } from "react";
import type { OrderRef } from "@/components/kitchen/KitchenLive";
import { useKitchenLive } from "@/components/kitchen/KitchenLive";
import { useKT } from "@/components/kitchen/KitchenI18n";
import PinPad from "@/components/kitchen/PinPad";
import Button from "@/components/kitchen/ui/Button";
import { Dialog } from "@/components/kitchen/ui/Dialog";
import ui from "@/components/kitchen/ui/ui.module.css";

/** CANCEL_PIN is 4 to 8 digits (config/tenant.server.ts). */
const PIN_MIN_DIGITS = 4;

/**
 * 取消 Cancel's confirm step, with the manager PIN.
 *
 * Staff take, print and edit orders on the board password; cancelling one
 * needs the manager PIN as well. The PIN is checked by the server on the
 * cancel itself (the browser never knows it), so this dialog stays open
 * until the answer: a wrong PIN shakes the field and says 密碼錯誤 Wrong PIN,
 * too many wrong ones lock the cancel for a minute with a countdown. The safe
 * choice (返回) is first in the DOM, as in every destructive confirm.
 */
export default function CancelPinDialog({
  order,
  note,
  onNoteChange,
  onClose,
  onCancelled,
}: {
  order: OrderRef;
  note: string;
  onNoteChange: (note: string) => void;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const t = useKT();
  const { cancelWithPin } = useKitchenLive();
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"wrong" | "unconfigured" | null>(null);
  /** Epoch ms the cooldown ends, and the seconds left, ticking. */
  const [lockedUntil, setLockedUntil] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (lockedUntil === 0) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) setLockedUntil(0);
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [lockedUntil]);

  const locked = secondsLeft > 0;
  const canSubmit = pin.length >= PIN_MIN_DIGITS && !busy && !locked && error !== "unconfigured";

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const result = await cancelWithPin(order, pin, note.trim() || undefined);
    setBusy(false);
    if (result.ok) {
      onNoteChange("");
      onCancelled();
      return;
    }
    setPin("");
    if (result.reason === "wrong") {
      setError(result.reason);
      setShake((n) => n + 1);
      if (result.retryAfterSeconds > 0) setLockedUntil(Date.now() + result.retryAfterSeconds * 1000);
    } else if (result.reason === "cooldown") {
      setError(null);
      setLockedUntil(Date.now() + result.retryAfterSeconds * 1000);
    } else if (result.reason === "unconfigured") {
      setError(result.reason);
    }
  };

  return (
    <Dialog title={t("card.cancelTitle", { number: order.orderNumber })} onClose={onClose}>
      <p className={ui.dialogText}>{t("confirm.cancelBody")}</p>
      <label className="flex flex-col gap-1.5">
        <span className="text-staff-body text-staff-soft">{t("card.cancelReason")}</span>
        <input
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          maxLength={300}
          className="min-h-14 rounded-staff-control bg-staff-panel px-3 text-staff-body shadow-[inset_0_0_0_1px_var(--color-staff-line-strong)] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-staff-brand)]"
        />
      </label>
      <div className="mt-3 flex flex-col gap-2" data-cancel-pin>
        <p className="text-staff-body text-staff-soft">{t("cancel.pinHint")}</p>
        <PinPad
          pin={pin}
          onChange={(next) => {
            setPin(next);
            if (error === "wrong") setError(null);
          }}
          onSubmit={() => void submit()}
          shake={shake}
          disabled={busy || locked || error === "unconfigured"}
          label={t("cancel.pinLabel")}
        />
        <p role="status" aria-live="polite" data-pin-error={locked ? "cooldown" : (error ?? "")} className="min-h-6 text-staff-body font-semibold text-staff-brand">
          {locked
            ? t("cancel.pinCooldown", { s: secondsLeft })
            : error === "wrong"
              ? t("cancel.pinWrong")
              : error === "unconfigured"
                ? t("cancel.pinUnconfigured")
                : ""}
        </p>
      </div>
      <div className={ui.dialogActions}>
        <Button variant="secondary" onClick={onClose}>
          {t("confirm.keep")}
        </Button>
        <Button variant="dangerSolid" data-action="confirm-cancel" disabled={!canSubmit} busy={busy} onClick={() => void submit()}>
          {t("card.cancelConfirm")}
        </Button>
      </div>
    </Dialog>
  );
}
