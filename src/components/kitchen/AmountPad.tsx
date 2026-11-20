"use client";

import { formatCents } from "@/lib/money";
import { pressKey } from "@/lib/kitchen/customCharge";
import { useKT } from "@/components/kitchen/KitchenI18n";
import Icon from "@/components/kitchen/Icon";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "back"] as const;

/**
 * Dollars on a keypad, cents first: 3, 0, 0 is $3.00, and $0.00 is allowed.
 * Every key is the 44px floor or more. A hardware keyboard works too while
 * the amount has focus (digits, Backspace, Delete clears).
 */
export default function AmountPad({
  cents,
  onChange,
  label,
  id,
}: {
  cents: number;
  /** A state setter: each key applies to the latest amount, however fast the taps. */
  onChange: React.Dispatch<React.SetStateAction<number>>;
  /** Names the amount for assistive tech. */
  label: string;
  id?: string;
}) {
  const t = useKT();
  return (
    <div className="flex flex-col gap-2" data-amount-pad>
      <output
        id={id}
        tabIndex={0}
        aria-label={label}
        data-amount={cents}
        onKeyDown={(e) => {
          const key = e.key === "Backspace" ? "back" : e.key === "Delete" ? "clear" : e.key;
          if (key === "back" || key === "clear" || /^\d$/.test(key)) {
            e.preventDefault();
            onChange((c) => pressKey(c, key));
          }
        }}
        className="flex min-h-14 items-center justify-end rounded-staff-control bg-staff-panel px-4 text-[1.636rem] font-bold tabular-nums text-staff-ink shadow-[inset_0_0_0_2px_var(--color-staff-sunken)] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-staff-brand)]"
      >
        {formatCents(cents)}
      </output>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label={t("pos.keypad")}>
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            data-key={k}
            aria-label={k === "back" ? t("pos.keypadBack") : undefined}
            onClick={() => onChange((c) => pressKey(c, k))}
            className="staff-press flex min-h-11 items-center justify-center rounded-xl bg-staff-panel text-[1.182rem] font-bold tabular-nums text-staff-ink shadow-staff-card hover:bg-staff-gold-tint"
          >
            {k === "back" ? <Icon name="chevronLeft" size={22} /> : k}
          </button>
        ))}
      </div>
    </div>
  );
}
