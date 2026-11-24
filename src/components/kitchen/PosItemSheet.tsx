"use client";

import { useRef, useState } from "react";
import type { MenuItem } from "@/lib/menu/types";
import { useItemChoice } from "@/lib/cart/useItemChoice";
import { resolveSizeZh } from "@/data/menu-overrides";
import { formatCents } from "@/lib/money";
import { useKT } from "@/components/kitchen/KitchenI18n";
import DishName from "@/components/kitchen/DishName";
import Icon from "@/components/kitchen/Icon";
import AmountPad from "@/components/kitchen/AmountPad";
import { chipClass } from "@/components/kitchen/CustomChargeSheet";
import { useSheetFocus } from "@/components/kitchen/ui/useSheetFocus";
import { CHARGE_PRESETS, MAX_CHARGE_NAME, presetLabel, type Surcharge } from "@/lib/kitchen/customCharge";
import { sizeHasNoRice } from "@/lib/kitchen/posTap";

export interface PosLineDraft {
  itemId: string;
  sizeId: string;
  modifierIds: string[];
  quantity: number;
  specialInstructions?: string;
  /** 加價: a typed per-unit charge on this dish line (lib/kitchen/customCharge). */
  surcharge?: Surcharge;
  /** 自訂: a custom line, named and priced by staff. itemId is "custom". */
  custom?: { name: string; amountCents: number };
}

const MAX_INSTRUCTIONS = 200;

/**
 * The POS item sheet: the customer sheet's LOGIC (useItemChoice: sizes, the
 * required groups, min/max, the live price) with a staff
 * surface in the POS system: warm ground, white option cards, the brand red
 * for what is chosen and for Add, every name in both languages.
 *
 * Keyed by item id from the parent, so a new dish starts clean.
 *
 * THE SHEET NEVER CHOOSES ON ITS OWN, unlike the customer sheet. What it
 * opens on comes from the screen: the portion staff tapped, the rice a tap
 * would have used (白飯, the menu's own default), or the line being edited. A
 * required choice the menu does not default (a lunch entrée, an "or" dish, a
 * family dinner's head count) opens blank, expanded and first, and Add stays
 * disabled until staff pick it.
 *
 * 加飯 Add rice: on a size that includes no rice (a tray, an appetizer, a
 * soup), a − n + row adds n × #116 Fried/Steamed Rice (單點, steamed) as its
 * OWN line beside this one, so the wok sees it on the kitchen copy. It is
 * never a surcharge, and it counts from 0 every time the sheet opens.
 */
/** One choice in the sheet (a size, a rice, an extra): selected is ringed in lacquer. */
/**
 * Three choices sit in one row (單點 · 半盤 · 餐盤, 白飯 · 炒飯 · 走飯): a scale
 * reads left to right. In a two-column grid the third was orphaned under
 * the others, as if it were an afterthought. Any other count keeps two
 * columns.
 */
const optionGrid = (count: number) => `grid gap-2 ${count === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`;

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

/** A section's head: tap to open or close it; the current choice shows while closed. */
function SectionHead({
  open,
  onToggle,
  name,
  nameEn,
  required,
  requiredLabel,
  extra,
  summary,
  unmet,
}: {
  open: boolean;
  onToggle: () => void;
  name: string;
  nameEn: string | null;
  required: boolean;
  requiredLabel: string;
  extra?: string | null;
  summary: string;
  unmet: boolean;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex min-h-[2.364rem] w-full flex-wrap items-center gap-x-2 rounded-xl py-1 text-left text-base font-semibold text-staff-soft hover:bg-staff-sunken/60"
    >
      <span className="text-base text-staff-ink">{name}</span>
      {nameEn && <span className="font-normal">{nameEn}</span>}
      {required && (
        <span
          className={`rounded-full px-2 text-base font-semibold text-staff-ink ${unmet ? "bg-staff-gold-tint" : "bg-staff-sunken"}`}
        >
          {requiredLabel}
        </span>
      )}
      {extra && <span className="text-base font-normal">{extra}</span>}
      <span className="ml-auto flex min-w-0 items-center gap-2">
        {!open && summary && <span className="truncate font-semibold text-staff-ink">{summary}</span>}
        <span aria-hidden="true" className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>
          ›
        </span>
      </span>
    </button>
  );
}

export default function PosItemSheet({
  item,
  initialSizeId,
  initial,
  editing = false,
  focus,
  menuNumber,
  riceSideCents = null,
  onAdd,
  onClose,
}: {
  item: MenuItem;
  /** Open on this size (the strip's default, or the line being edited). */
  initialSizeId?: string;
  /** Open on these choices, quantity and note (a line on the ticket being edited). */
  initial?: { modifierIds?: readonly string[]; quantity?: number; instructions?: string; surcharge?: Surcharge };
  /** Changing a line already on the ticket: the button says Update. */
  editing?: boolean;
  /**
   * The one choice to open expanded, the rest closed: a group id, or "size".
   * A tile tap that asks sets it to the choice the defaults did not cover.
   * Unset: every section open.
   */
  focus?: string;
  menuNumber: number | null;
  /** #116's 單點 price, or null when the menu cannot sell it (no 加飯 row). */
  riceSideCents?: number | null;
  /** The line, and how many #116 rice lines to add beside it. */
  onAdd: (line: PosLineDraft, extraRice: number) => void;
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
  } = useItemChoice(item, initialSizeId, false, initial);

  /** Which sections are open. A focused sheet opens just the choice it needs. */
  const [open, setOpen] = useState<Set<string>>(() =>
    focus ? new Set([focus]) : new Set(["size", "instructions", ...item.modifierGroups.map((g) => g.id)]),
  );
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /**
   * A single choice made: if another required one is still unmade, open it
   * next, so "Choose first" always has its section in view.
   */
  function choose(groupId: string, modId: string, maxAllowed: number | null) {
    toggleModifier(groupId, modId, maxAllowed);
    if (maxAllowed !== 1) return;
    const nextUnmet = unmetGroups.find((g) => g.id !== groupId);
    if (nextUnmet) setOpen((prev) => new Set(prev).add(nextUnmet.id));
  }

  /**
   * 加價 Add charge: an amount and what it is for, per unit, kept on this
   * line. Open when the line already has one.
   */
  const [chargeCents, setChargeCents] = useState(initial?.surcharge?.amountCents ?? 0);
  const [chargeLabel, setChargeLabel] = useState(initial?.surcharge?.label ?? "");
  const chargeOn = chargeCents > 0 && chargeLabel.trim().length > 0;
  const chargeHalf = (chargeCents > 0) !== (chargeLabel.trim().length > 0);
  const [chargeOpen, setChargeOpen] = useState(initial?.surcharge !== undefined);

  /**
   * A modal that keeps the keyboard: focus starts on the choice the sheet was
   * opened for (else Add, else the first option), Tab and Shift+Tab cycle
   * inside the sheet, Escape closes it, and focus goes back to the tile or
   * line that opened it.
   */
  const panelRef = useRef<HTMLDivElement>(null);
  useSheetFocus(
    panelRef,
    onClose,
    (panel) =>
      (focus ? panel.querySelector<HTMLElement>(`[data-section="${focus}"] [aria-pressed]`) : null) ??
      panel.querySelector<HTMLElement>('[data-action="sheet-add"]:not(:disabled)') ??
      panel.querySelector<HTMLElement>("[aria-pressed]"),
  );

  const [extraRice, setExtraRice] = useState(0);
  const riceRow = riceSideCents !== null && sizeId !== "" && sizeHasNoRice(item, sizeId);
  const riceCount = riceRow ? extraRice : 0;

  function add() {
    if (!groupsValid || chargeHalf) return;
    onAdd({
      itemId: item.id,
      sizeId,
      modifierIds,
      quantity,
      specialInstructions: instructions.trim() || undefined,
      ...(chargeOn ? { surcharge: { amountCents: chargeCents, label: chargeLabel.trim() } } : {}),
    }, riceCount);
  }
  const lineCents = priceCents + (chargeOn ? chargeCents * quantity : 0) + riceCount * (riceSideCents ?? 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={item.nameZh ? `${item.nameZh} ${item.nameEn}` : item.nameEn}
    >
      <button aria-hidden="true" tabIndex={-1} className="absolute inset-0 bg-staff-scrim" onClick={onClose} />
      <div
        ref={panelRef}
        className="staff-sheet-in relative z-10 flex max-h-[92svh] w-full max-w-[36rem] flex-col overflow-hidden rounded-t-[24px] bg-staff-bg text-staff-ink shadow-staff-raised sm:rounded-[24px]"
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
          <div className="flex min-w-0 items-start gap-3">
            {menuNumber !== null && (
              <span className="mt-1 rounded-lg bg-staff-sunken px-2 text-base font-semibold text-staff-soft tabular-nums">
                #{menuNumber}
              </span>
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
            <fieldset className="mb-4" data-section="size">
              <legend className="mb-2 w-full">
                <SectionHead
                  open={open.has("size")}
                  onToggle={() => toggle("size")}
                  name={t("sheet.size")}
                  nameEn={null}
                  required={false}
                  requiredLabel={t("sheet.required")}
                  summary={(() => {
                    const cur = sizes.find((x) => x.id === sizeId);
                    return cur ? `${resolveSizeZh(cur.label) ?? ""} ${cur.label}`.trim() : "";
                  })()}
                  unmet={false}
                />
              </legend>
              {open.has("size") && (
                <div className={optionGrid(sizes.length)}>
                  {sizes.map((s) => {
                    const zh = resolveSizeZh(s.label);
                    const on = sizeId === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSizeId(s.id)}
                        className={option(on)}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          {check(on)}
                          <DishName nameZh={zh} nameEn={s.label} size="sm" />
                        </span>
                        <span className="font-bold tabular-nums">{formatCents(s.priceCents)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </fieldset>
          )}

          {riceRow && (
            <div
              data-section="add-rice"
              className="mb-4 flex min-h-16 items-center justify-between gap-4 rounded-2xl bg-staff-panel py-2.5 pr-3 pl-4 shadow-staff-card"
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-[1.091rem] font-semibold">
                  <span lang="zh-Hant">{t("pos.addRiceRowZh")}</span>{" "}
                  <span lang="en" className="font-medium text-staff-soft">
                    {t("pos.addRiceRowEn")}
                  </span>
                </span>
                <span className="text-base text-staff-soft">{t("pos.addRiceRowHint")}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1" role="group" aria-label={t("pos.addRiceAria", { price: formatCents(riceSideCents ?? 0) })}>
                <span className="mr-2 font-bold tabular-nums">+{formatCents(riceSideCents ?? 0)}</span>
                <button
                  type="button"
                  data-action="rice-less"
                  onClick={() => setExtraRice((n) => Math.max(0, n - 1))}
                  disabled={extraRice === 0}
                  aria-label={t("pos.decrease")}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-staff-sunken text-staff-ink hover:bg-staff-gold-tint disabled:opacity-40"
                >
                  <Icon name="minus" size={22} />
                </button>
                <span className="w-8 text-center text-[1.364rem] font-bold tabular-nums" aria-live="polite" data-rice-count>
                  {extraRice}
                </span>
                <button
                  type="button"
                  data-action="rice-more"
                  onClick={() => setExtraRice((n) => Math.min(50, n + 1))}
                  aria-label={t("pos.increase")}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-staff-sunken text-staff-ink hover:bg-staff-gold-tint"
                >
                  <Icon name="plus" size={22} />
                </button>
              </div>
            </div>
          )}

          {groups.map((g) => {
            const chosen = g.modifiers.filter((m) => isSelected(g.id, m.id));
            const isUnmet = unmetGroups.some((u) => u.id === g.id);
            return (
              <fieldset key={g.id} className="mb-4" data-section={g.id}>
                <legend className="mb-2 w-full">
                  <SectionHead
                    open={open.has(g.id)}
                    onToggle={() => toggle(g.id)}
                    name={g.nameZh ?? g.nameEn}
                    nameEn={g.nameZh ? g.nameEn : null}
                    required={g.minRequired > 0}
                    requiredLabel={t("sheet.required")}
                    extra={g.maxAllowed !== null && g.maxAllowed > 1 ? t("sheet.upTo", { n: g.maxAllowed }) : null}
                    summary={chosen.map((m) => m.nameZh ?? m.nameEn).join("、")}
                    unmet={isUnmet}
                  />
                </legend>
                {open.has(g.id) && (
                  <div className={optionGrid(g.modifiers.length)}>
                    {g.modifiers.map((m) => {
                      const selected = isSelected(g.id, m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => choose(g.id, m.id, g.maxAllowed)}
                          className={option(selected)}
                        >
                          <span className="flex min-w-0 items-center gap-3">
                            {check(selected)}
                            <span className="flex min-w-0 flex-col">
                              <DishName nameZh={m.nameZh} nameEn={m.nameEn} size="sm" />
                              {m.note && <span className="text-base text-staff-soft">{m.note}</span>}
                            </span>
                          </span>
                          {m.priceCents > 0 && (
                            <span className="text-base font-semibold tabular-nums">+{formatCents(m.priceCents)}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </fieldset>
            );
          })}

          <div data-section="instructions">
            <SectionHead
              open={open.has("instructions")}
              onToggle={() => toggle("instructions")}
              name={t("sheet.instructions")}
              nameEn={null}
              required={false}
              requiredLabel={t("sheet.required")}
              summary={instructions.trim()}
              unmet={false}
            />
          </div>
          {open.has("instructions") && (
            <label className="mt-2 block">
              <span className="sr-only">{t("sheet.instructions")}</span>
              <textarea
                value={instructions}
                maxLength={MAX_INSTRUCTIONS}
                onChange={(e) => setInstructions(e.target.value)}
                rows={2}
                placeholder={t("sheet.instructionsPlaceholder")}
                className="w-full resize-none rounded-xl bg-staff-panel px-4 py-3 text-base shadow-[inset_0_0_0_2px_var(--color-staff-sunken)] outline-none placeholder:text-staff-soft focus:shadow-[inset_0_0_0_2px_var(--color-staff-brand)]"
              />
            </label>
          )}

          <div data-section="charge" className="mt-4">
            <SectionHead
              open={chargeOpen}
              onToggle={() => setChargeOpen((o) => !o)}
              name={t("pos.charge.zh")}
              nameEn={t("pos.charge.en")}
              required={false}
              requiredLabel={t("sheet.required")}
              summary={chargeOn ? `+${formatCents(chargeCents)} ${chargeLabel.trim()}` : ""}
              unmet={false}
            />
          </div>
          {chargeOpen && (
            <div className="mt-2 flex flex-col gap-3" data-charge>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("pos.custom.quick")}>
                {CHARGE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    data-preset={p.id}
                    aria-pressed={chargeLabel.trim() === presetLabel(p)}
                    onClick={() => setChargeLabel(presetLabel(p))}
                    className={chipClass(chargeLabel.trim() === presetLabel(p))}
                  >
                    <span lang="zh-Hant">{p.zh}</span>
                    <span lang="en" className="font-normal text-staff-soft">
                      {p.en}
                    </span>
                  </button>
                ))}
              </div>
              <label className="block">
                <span className="mb-2 block text-base font-semibold">{t("pos.charge.label")}</span>
                <input
                  value={chargeLabel}
                  onChange={(e) => setChargeLabel(e.target.value)}
                  maxLength={MAX_CHARGE_NAME}
                  autoComplete="off"
                  data-field="charge-label"
                  placeholder={t("pos.custom.namePlaceholder")}
                  className="min-h-14 w-full rounded-staff-control bg-staff-panel px-4 text-base text-staff-ink shadow-[inset_0_0_0_2px_var(--color-staff-sunken)] outline-none placeholder:text-staff-soft focus-visible:shadow-[inset_0_0_0_2px_var(--color-staff-brand)]"
                />
              </label>
              <AmountPad cents={chargeCents} onChange={setChargeCents} label={t("pos.charge.amount")} />
            </div>
          )}
        </div>

        {chargeHalf && groupsValid && (
          <p role="status" className="bg-staff-gold-tint px-6 py-2.5 text-base font-medium">
            {t("pos.charge.incomplete")}
          </p>
        )}
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
            disabled={!groupsValid || chargeHalf}
            data-action="sheet-add"
            className="flex h-[4rem] flex-1 items-center justify-between gap-3 rounded-pos bg-staff-brand px-6 text-[1.182rem] font-bold whitespace-nowrap text-staff-on-brand transition-colors hover:bg-staff-brand-hover disabled:cursor-not-allowed disabled:bg-staff-sunken disabled:text-staff-soft"
          >
            <span>{editing ? t("sheet.update") : t("sheet.add")}</span>
            <span className="tabular-nums">{formatCents(lineCents)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
