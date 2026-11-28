"use client";

import { useKT } from "@/components/kitchen/KitchenI18n";
import Icon from "@/components/kitchen/Icon";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;
export const PIN_MAX_DIGITS = 8;

/**
 * The manager PIN for 取消 Cancel: digits only, masked, AmountPad's key grid
 * (every key the 44px floor or more). A hardware keyboard works while the
 * field has focus: digits, Backspace, Delete clears, Enter submits.
 *
 * `shake` is a counter: each wrong PIN bumps it, and the field shakes once
 * (the key on the field restarts the animation). Reduced motion: no shake,
 * the 密碼錯誤 line under it says the same thing.
 */
export default function PinPad({
  pin,
  onChange,
  onSubmit,
  shake,
  disabled = false,
  label,
}: {
  pin: string;
  onChange: React.Dispatch<React.SetStateAction<string>>;
  onSubmit: () => void;
  shake: number;
  disabled?: boolean;
  label: string;
}) {
  const t = useKT();
  const press = (k: (typeof KEYS)[number] | string) => {
    if (disabled) return;
    if (k === "clear") onChange("");
    else if (k === "back") onChange((p) => p.slice(0, -1));
    else if (/^\d$/.test(k)) onChange((p) => (p.length >= PIN_MAX_DIGITS ? p : p + k));
  };
  return (
    <div className="flex flex-col gap-2" data-pin-pad>
      <output
        key={shake}
        tabIndex={0}
        aria-label={label}
        data-pin-length={pin.length}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
            return;
          }
          const key = e.key === "Backspace" ? "back" : e.key === "Delete" ? "clear" : e.key;
          if (key === "back" || key === "clear" || /^\d$/.test(key)) {
            e.preventDefault();
            press(key);
          }
        }}
        className={`flex min-h-14 items-center justify-center gap-3 rounded-staff-control bg-staff-panel px-4 text-staff-ink shadow-[inset_0_0_0_2px_var(--color-staff-sunken)] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-staff-brand)] ${shake > 0 ? "staff-shake" : ""}`}
      >
        {pin.length === 0 ? (
          <span className="text-staff-body text-staff-soft">{label}</span>
        ) : (
          Array.from({ length: pin.length }, (_, i) => (
            <span key={i} aria-hidden="true" className="size-3.5 rounded-full bg-staff-ink" />
          ))
        )}
      </output>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label={t("pos.keypad")}>
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            data-pin-key={k}
            disabled={disabled}
            aria-label={k === "back" ? t("pos.keypadBack") : k === "clear" ? t("cancel.pinClear") : undefined}
            onClick={() => press(k)}
            className="staff-press flex min-h-14 items-center justify-center rounded-xl bg-staff-panel text-[1.364rem] font-bold tabular-nums text-staff-ink shadow-staff-card hover:bg-staff-gold-tint disabled:opacity-50"
          >
            {k === "back" ? <Icon name="chevronLeft" size={22} /> : k === "clear" ? t("cancel.pinClearShort") : k}
          </button>
        ))}
      </div>
    </div>
  );
}
