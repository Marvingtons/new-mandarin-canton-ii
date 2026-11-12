"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Icon, { type IconName } from "@/components/kitchen/Icon";
import Button from "@/components/kitchen/ui/Button";
import { useKT } from "@/components/kitchen/KitchenI18n";
import ui from "@/components/kitchen/ui/ui.module.css";

/**
 * Feedback that does not move the page: bottom-right, stacked, gone on its
 * own. One provider for the whole staff app, so a rollback on the board and a
 * "sent" on the POS look the same.
 *
 *   info     an action went through
 *   error    the server refused and the change was undone (stays longer)
 *   arrival  a new online order (gold, the Online station's colour)
 */
export type ToastTone = "info" | "error" | "arrival";

interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
}

interface ToastApi {
  toast: (text: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const LIFETIME: Record<ToastTone, number> = { info: 4_000, arrival: 8_000, error: 10_000 };
const ICON: Record<ToastTone, IconName> = { info: "check", arrival: "bell", error: "alert" };
const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const t = useKT();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  // Auto-dismiss timers, cleared if the staff app unmounts first.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) clearTimeout(id);
      pending.clear();
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (text: string, tone: ToastTone = "info") => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-(MAX_VISIBLE - 1)), { id, tone, text }]);
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        dismiss(id);
      }, LIFETIME[tone]);
      timers.current.add(timer);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ toast }), [toast]);

  // One pass: errors go to the assertive region, everything else waits its turn.
  const [polite, assertive] = useMemo(() => {
    const quiet: Toast[] = [];
    const loud: Toast[] = [];
    for (const x of toasts) (x.tone === "error" ? loud : quiet).push(x);
    return [quiet, loud];
  }, [toasts]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Two live regions: errors interrupt, everything else waits its turn. */}
      <div className={ui.toasts}>
        <div role="status" aria-live="polite" className="flex flex-col-reverse gap-2">
          {polite.map((x) => (
            <ToastView key={x.id} toast={x} onDismiss={dismiss} dismissLabel={t("common.dismiss")} />
          ))}
        </div>
        <div role="alert" className="flex flex-col-reverse gap-2">
          {assertive.map((x) => (
            <ToastView key={x.id} toast={x} onDismiss={dismiss} dismissLabel={t("common.dismiss")} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({
  toast,
  onDismiss,
  dismissLabel,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
  dismissLabel: string;
}) {
  return (
    <div className={ui.toast} data-tone={toast.tone}>
      <Icon name={ICON[toast.tone]} size={22} />
      <span className={ui.toastText}>{toast.text}</span>
      <Button variant="quiet" size="sm" iconOnly icon="x" aria-label={dismissLabel} onClick={() => onDismiss(toast.id)} />
    </div>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast outside ToastProvider");
  return api;
}
