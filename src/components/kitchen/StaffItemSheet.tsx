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
 * surface: ink ground, big tap targets, every name in both languages.
 *
 * Keyed by item id from the parent, so a new dish starts clean.
 */
export default function StaffItemSheet({
  item,
  menuNumber,
  onAdd,
  onClose,
}: {
  item: MenuItem;
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
  } = useItemChoice(item);

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
    `relative flex min-h-14 items-center justify-between gap-3 rounded-md border px-4 py-2.5 text-left transition-colors ${
      selected
        ? "border-staff-accent bg-staff-accent-tint text-staff-ink ring-1 ring-staff-accent"
        : "border-staff-line-strong bg-staff-panel text-staff-ink hover:bg-staff-sunken"
    }`;

  /** The selection mark every option shares: sizes, rice, extras alike. */
  const check = (on: boolean) => (
    <span
      aria-hidden="true"
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
        on ? "border-staff-accent bg-staff-accent text-white" : "border-staff-line-strong"
      }`}
    >
      {on && <Icon name="check" size={13} />}
    </span>
  );

  const sectionLabel = "mb-2 flex flex-wrap items-baseline gap-2 text-sm font-semibold text-staff-soft";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={item.nameZh ? `${item.nameZh} ${item.nameEn}` : item.nameEn}
    >
      <button aria-hidden="true" tabIndex={-1} className="absolute inset-0 bg-staff-ink/45" onClick={onClose} />
      <div className="relative z-10 flex max-h-[92svh] w-full max-w-2xl flex-col overflow-hidden rounded-t-lg bg-staff-panel shadow-[0_24px_48px_-16px_rgba(27,26,23,0.35)] sm:rounded-lg">
        <div className="flex items-start justify-between gap-4 border-b border-staff-line px-6 py-4">
          <div className="flex min-w-0 items-start gap-3">
            {menuNumber !== null && (
              <span className="mt-1 rounded-sm bg-staff-sunken px-2 py-0.5 text-base font-semibold text-staff-soft">#{menuNumber}</span>
            )}
            <DishName nameZh={item.nameZh} nameEn={item.nameEn} size="lg" />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("sheet.close")}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-staff-soft hover:bg-staff-sunken hover:text-staff-ink"
          >
            <Icon name="x" size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {item.description && <p className="mb-5 text-sm text-staff-faint">{item.description}</p>}

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
                      <span className="font-semibold">{formatCents(s.priceCents)}</span>
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
                {g.nameZh && <span className="font-normal text-staff-faint">{g.nameEn}</span>}
                {g.minRequired > 0 && (
                  <span className="rounded-full bg-staff-warn-tint px-2 py-0.5 text-xs font-semibold text-staff-warn">
                    {t("sheet.required")}
                  </span>
                )}
                {g.maxAllowed !== null && g.maxAllowed > 1 && (
                  <span className="text-xs font-normal text-staff-faint">{t("sheet.upTo", { n: g.maxAllowed })}</span>
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
                          {m.note && <span className="text-xs text-staff-faint">{m.note}</span>}
                        </span>
                      </span>
                      {m.priceCents > 0 && <span className="text-sm font-semibold">+{formatCents(m.priceCents)}</span>}
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
              className="w-full resize-none rounded-md border border-staff-line-strong bg-staff-panel px-3 py-2 text-base outline-none placeholder:text-staff-faint focus:border-staff-accent"
            />
          </label>
        </div>

        {!groupsValid && (
          <p role="status" className="border-t border-staff-line bg-staff-warn-tint px-6 py-2.5 text-sm font-medium text-staff-warn">
            {t("sheet.unmet", {
              groups: unmetGroups.map((g) => g.nameZh ?? g.nameEn).join(" · "),
            })}
          </p>
        )}
        <div className="flex items-center gap-3 border-t border-staff-line px-6 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
          <div className="flex items-center rounded-md border border-staff-line-strong" role="group" aria-label={t("sheet.quantity")}>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label={t("pos.decrease")}
              className="flex h-14 w-14 items-center justify-center rounded-l-md text-staff-ink hover:bg-staff-sunken"
            >
              <Icon name="minus" size={20} />
            </button>
            <span className="w-10 text-center text-xl font-semibold" aria-live="polite">
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(50, q + 1))}
              aria-label={t("pos.increase")}
              className="flex h-14 w-14 items-center justify-center rounded-r-md text-staff-ink hover:bg-staff-sunken"
            >
              <Icon name="plus" size={20} />
            </button>
          </div>
          <button
            type="button"
            onClick={add}
            disabled={!groupsValid}
            className="flex min-h-14 flex-1 items-center justify-between gap-3 rounded-md bg-staff-accent px-5 text-lg font-semibold text-white transition-colors hover:bg-staff-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span>{t("sheet.add")}</span>
            <span>{formatCents(priceCents)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
