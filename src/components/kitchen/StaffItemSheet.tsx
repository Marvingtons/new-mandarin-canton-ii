"use client";

import { useEffect } from "react";
import type { MenuItem } from "@/lib/menu/types";
import { useItemChoice } from "@/lib/cart/useItemChoice";
import { resolveSizeZh } from "@/data/menu-overrides";
import { formatCents } from "@/lib/money";
import { useKT } from "@/components/kitchen/KitchenI18n";
import DishName from "@/components/kitchen/DishName";
import Icon from "@/components/kitchen/Icon";

export interface StaffLineDraft {
  itemId: string;
  sizeId: string;
  modifierIds: string[];
  quantity: number;
  specialInstructions?: string;
}

const MAX_INSTRUCTIONS = 200;

/**
 * The POS item sheet: the customer sheet's LOGIC (useItemChoice: sizes, the
 * required groups and their defaults, min/max, the live price) with a staff
 * surface in the POS system: warm ground, white option cards, the brand red
 * for what is chosen and for Add, every name in both languages.
 *
 * Keyed by item id from the parent, so a new dish starts clean.
 */
export default function StaffItemSheet({
  item,
  initialSizeId,
  menuNumber,
  onAdd,
  onClose,
}: {
  item: MenuItem;
  /** Open on this size (the tray button on a dish card). */
  initialSizeId?: string;
  menuNumber: number | null;
  onAdd: (line: StaffLineDraft) => void;
  onClose: () => void;
}) {
  const t = useKT();
  const {
    sizes,
    sizeId,
    setSizeId,
    groups,
    modifierIds,
    toggleModifier,
    isSelected,
    quantity,
    setQuantity,
    instructions,
    setInstructions,
    priceCents,
    unmetGroups,
    groupsValid,
  } = useItemChoice(item, initialSizeId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function add() {
    if (!groupsValid) return;
    onAdd({
      itemId: item.id,
      sizeId,
      modifierIds,
      quantity,
      specialInstructions: instructions.trim() || undefined,
    });
  }

  const option = (selected: boolean) =>
    `staff-press relative flex min-h-[2.909rem] items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-left text-staff-ink transition-colors ${
      selected
        ? "bg-staff-brand-tint shadow-[inset_0_0_0_3px_var(--color-staff-brand)]"
        : "bg-staff-panel shadow-staff-card hover:bg-staff-gold-tint"
    }`;

  /** The selection mark every option shares: sizes, rice, extras alike. */
  const check = (on: boolean) => (
    <span
      aria-hidden="true"
      className={`flex h-[1.091rem] w-[1.091rem] shrink-0 items-center justify-center rounded-full ${
        on ? "bg-staff-brand text-staff-on-brand" : "shadow-[inset_0_0_0_2px_var(--color-staff-line-strong)]"
      }`}
    >
      {on && <Icon name="check" size={13} />}
    </span>
  );

  const sectionLabel = "mb-3 flex flex-wrap items-baseline gap-2 text-base font-semibold text-staff-soft";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={item.nameZh ? `${item.nameZh} ${item.nameEn}` : item.nameEn}
    >
      <button aria-hidden="true" tabIndex={-1} className="absolute inset-0 bg-staff-scrim" onClick={onClose} />
      <div className="staff-sheet-in relative z-10 flex max-h-[92svh] w-full max-w-[36rem] flex-col overflow-hidden rounded-t-[24px] bg-staff-bg text-staff-ink shadow-staff-raised sm:rounded-[24px]">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
          <div className="flex min-w-0 items-start gap-3">
            {menuNumber !== null && (
              <span className="mt-1 rounded-lg bg-staff-sunken px-2 text-base font-semibold text-staff-soft tabular-nums">#{menuNumber}</span>
            )}
            <DishName nameZh={item.nameZh} nameEn={item.nameEn} size="lg" />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("sheet.close")}
            className="-mr-2 flex h-[2.545rem] w-[2.545rem] shrink-0 items-center justify-center rounded-full text-staff-soft hover:bg-staff-sunken hover:text-staff-ink"
          >
            <Icon name="x" size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pt-3 pb-5">
          {sizes.length > 1 && (
            <fieldset className="mb-6">
              <legend className={sectionLabel}>{t("sheet.size")}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {sizes.map((s) => {
                  const zh = resolveSizeZh(s.label);
                  const on = sizeId === s.id;
                  return (
                    <button key={s.id} type="button" aria-pressed={on} onClick={() => setSizeId(s.id)} className={option(on)}>
                      <span className="flex min-w-0 items-center gap-3">
                        {check(on)}
                        <DishName nameZh={zh} nameEn={s.label} size="sm" />
                      </span>
                      <span className="font-bold tabular-nums">{formatCents(s.priceCents)}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {groups.map((g) => (
            <fieldset key={g.id} className="mb-6">
              <legend className={sectionLabel}>
                <span className="text-base text-staff-ink">{g.nameZh ?? g.nameEn}</span>
                {g.nameZh && <span className="font-normal">{g.nameEn}</span>}
                {g.minRequired > 0 && (
                  <span className="rounded-full bg-staff-gold-tint px-2 text-base font-semibold text-staff-ink">
                    {t("sheet.required")}
                  </span>
                )}
                {g.maxAllowed !== null && g.maxAllowed > 1 && (
                  <span className="text-base font-normal">{t("sheet.upTo", { n: g.maxAllowed })}</span>
                )}
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {g.modifiers.map((m) => {
                  const selected = isSelected(g.id, m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleModifier(g.id, m.id, g.maxAllowed)}
                      className={option(selected)}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        {check(selected)}
                        <span className="flex min-w-0 flex-col">
                          <DishName nameZh={m.nameZh} nameEn={m.nameEn} size="sm" />
                          {m.note && <span className="text-base text-staff-soft">{m.note}</span>}
                        </span>
                      </span>
                      {m.priceCents > 0 && <span className="text-base font-semibold tabular-nums">+{formatCents(m.priceCents)}</span>}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}

          <label className="block">
            <span className={sectionLabel}>{t("sheet.instructions")}</span>
            <textarea
              value={instructions}
              maxLength={MAX_INSTRUCTIONS}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              placeholder={t("sheet.instructionsPlaceholder")}
              className="w-full resize-none rounded-xl bg-staff-panel px-4 py-3 text-base shadow-[inset_0_0_0_2px_var(--color-staff-sunken)] outline-none placeholder:text-staff-soft focus:shadow-[inset_0_0_0_2px_var(--color-staff-brand)]"
            />
          </label>
        </div>

        {!groupsValid && (
          <p role="status" className="bg-staff-gold-tint px-6 py-2.5 text-base font-medium">
            {t("sheet.unmet", {
              groups: unmetGroups.map((g) => g.nameZh ?? g.nameEn).join(" · "),
            })}
          </p>
        )}
        <div className="flex items-center gap-4 bg-staff-panel px-6 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
          <div className="flex items-center gap-1" role="group" aria-label={t("sheet.quantity")}>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label={t("pos.decrease")}
              className="flex h-[2.545rem] w-[2.545rem] items-center justify-center rounded-full bg-staff-sunken text-staff-ink hover:bg-staff-gold-tint"
            >
              <Icon name="minus" size={22} />
            </button>
            <span className="w-[2.364rem] text-center text-[1.364rem] font-bold tabular-nums" aria-live="polite">
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(50, q + 1))}
              aria-label={t("pos.increase")}
              className="flex h-[2.545rem] w-[2.545rem] items-center justify-center rounded-full bg-staff-sunken text-staff-ink hover:bg-staff-gold-tint"
            >
              <Icon name="plus" size={22} />
            </button>
          </div>
          <button
            type="button"
            onClick={add}
            disabled={!groupsValid}
            className="flex h-[4rem] flex-1 items-center justify-between gap-3 rounded-pos bg-staff-brand px-6 text-[1.182rem] font-bold whitespace-nowrap text-staff-on-brand transition-colors hover:bg-staff-brand-hover disabled:cursor-not-allowed disabled:bg-staff-sunken disabled:text-staff-soft"
          >
            <span>{t("sheet.add")}</span>
            <span className="tabular-nums">{formatCents(priceCents)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
