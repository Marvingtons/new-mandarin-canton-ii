"use client";

import { useRef } from "react";
import type { MenuItem, MenuSize } from "@/lib/menu/types";
import { formatCents } from "@/lib/money";
import { resolveSizeZh } from "@/data/menu-overrides";
import { useKT } from "@/components/kitchen/KitchenI18n";
import Icon from "@/components/kitchen/Icon";
import { useSheetFocus } from "@/components/kitchen/ui/useSheetFocus";

/**
 * 份量 Portion: what a tap on a dish sold in more than one size opens. One
 * big button per size, in one row; a tap adds the line and closes. Nothing
 * else is here (no rice, no note, no quantity): the 改 corner is the full sheet.
 *
 * HIGHLIGHTED, NOT CHOSEN. `highlight` (the portion last picked on this
 * ticket, 單點 on a new one) gets the lacquer ring and the keyboard focus, so
 * Enter repeats it, but nothing is added until a button is pressed. A catering
 * call of six half trays is six deliberate taps, never a hidden default.
 *
 * Keys: focus starts on the highlight; ← → move; Enter or Space adds; 1 / 2 / 3
 * add that portion directly; Esc closes without adding.
 */
export default function PortionSheet({
  item,
  sizes,
  highlight,
  onPick,
  onClose,
}: {
  item: MenuItem;
  sizes: readonly MenuSize[];
  highlight: string | null;
  onPick: (sizeId: string) => void;
  onClose: () => void;
}) {
  const t = useKT();
  const panelRef = useRef<HTMLDivElement>(null);
  const lit = sizes.some((s) => s.id === highlight) ? highlight : sizes[0]?.id;
  useSheetFocus(panelRef, onClose, (panel) =>
    panel.querySelector<HTMLElement>(`[data-portion="${lit}"]`),
  );

  function onKeyDown(e: React.KeyboardEvent) {
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= sizes.length) {
      e.preventDefault();
      onPick(sizes[n - 1].id);
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const buttons = [...(panelRef.current?.querySelectorAll<HTMLElement>("[data-portion]") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    const next = buttons[(at + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
    e.preventDefault();
    next?.focus();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t("pos.portion.aria")}
      data-sheet="portion"
    >
      <button aria-hidden="true" tabIndex={-1} className="absolute inset-0 bg-staff-scrim" onClick={onClose} />
      <div
        ref={panelRef}
        onKeyDown={onKeyDown}
        className="staff-sheet-in relative z-10 w-full max-w-[44rem] rounded-[24px] bg-staff-bg px-6 pt-5 pb-6 text-staff-ink shadow-staff-raised"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="flex items-baseline gap-2">
              <span lang="zh-Hant" className="text-[1.364rem] font-bold">
                {t("pos.portion.titleZh")}
              </span>
              <span lang="en" className="text-base text-staff-soft">
                {t("pos.portion.titleEn")}
              </span>
            </h2>
            <p className="mt-1 truncate text-base text-staff-soft">
              {item.nameZh && (
                <span lang="zh-Hant" className="font-semibold text-staff-ink">
                  {item.nameZh}{" "}
                </span>
              )}
              <span lang="en">{item.nameEn}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("sheet.close")}
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-staff-soft hover:bg-staff-sunken hover:text-staff-ink"
          >
            <Icon name="x" size={22} />
          </button>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${sizes.length}, minmax(0, 1fr))` }}>
          {sizes.map((s) => {
            const on = s.id === lit;
            const zh = resolveSizeZh(s.label);
            return (
              <button
                key={s.id}
                type="button"
                data-portion={s.id}
                data-highlight={on || undefined}
                onClick={() => onPick(s.id)}
                aria-label={`${zh ?? ""} ${s.label} ${formatCents(s.priceCents)}`.trim()}
                className={`staff-press flex min-h-[8.25rem] flex-col items-center justify-center gap-1 rounded-[18px] p-3 text-center transition-colors outline-none focus-visible:ring-4 focus-visible:ring-staff-gold ${
                  on
                    ? "bg-staff-brand-tint shadow-[inset_0_0_0_3px_var(--color-staff-brand)]"
                    : "bg-staff-panel shadow-staff-card hover:bg-staff-gold-tint"
                }`}
              >
                {zh && (
                  <span lang="zh-Hant" className="text-[1.636rem] leading-tight font-bold">
                    {zh}
                  </span>
                )}
                <span lang="en" className="text-base text-staff-soft">
                  {s.label}
                </span>
                <span className="mt-1.5 text-[1.273rem] font-bold tabular-nums">{formatCents(s.priceCents)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
