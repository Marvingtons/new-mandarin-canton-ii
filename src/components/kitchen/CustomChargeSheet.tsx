"use client";

import { useRef, useState } from "react";
import { formatCents } from "@/lib/money";
import {
  CHARGE_PRESETS,
  MAX_CHARGE_NAME,
  presetLabel,
} from "@/lib/kitchen/customCharge";
import { useKT } from "@/components/kitchen/KitchenI18n";
import Icon from "@/components/kitchen/Icon";
import AmountPad from "@/components/kitchen/AmountPad";
import { useSheetFocus } from "@/components/kitchen/ui/useSheetFocus";

export interface CustomChargeDraft {
  name: string;
  amountCents: number;
  quantity: number;
  specialInstructions?: string;
}

/** The shared chip look: lacquer ring when chosen, the 44px floor. */
export const chipClass = (on: boolean) =>
  `staff-press flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-base font-semibold transition-colors ${
    on
      ? "bg-staff-brand-tint text-staff-ink shadow-[inset_0_0_0_3px_var(--color-staff-brand)]"
      : "bg-staff-panel text-staff-ink shadow-staff-card hover:bg-staff-gold-tint"
  }`;

/**
 * 自訂 Custom: a line staff name and price themselves. A name (the last one
 * used, or a quick chip; 其他 Other clears it for typing), an amount on the
 * keypad ($0.00 allowed), a quantity and a note. Taxed and printed like any
 * dish; the kitchen copy shows it without its price.
 */
export default function CustomChargeSheet({
  initial,
  editing = false,
  onAdd,
  onClose,
}: {
  initial: CustomChargeDraft;
  editing?: boolean;
  onAdd: (draft: CustomChargeDraft) => void;
  onClose: () => void;
}) {
  const t = useKT();
  const [name, setName] = useState(initial.name);
  const [amountCents, setAmountCents] = useState(initial.amountCents);
  const [quantity, setQuantity] = useState(initial.quantity);
  const [note, setNote] = useState(initial.specialInstructions ?? "");
  // The note is tap-to-edit: open only when there is one already.
  const [noteOpen, setNoteOpen] = useState(note.length > 0);
  const nameRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /**
   * THE AMOUNT HAS FOCUS ON OPEN, ALWAYS. Focusing the name field when there
   * was no remembered name raised the iPad's keyboard over the bottom of the
   * sheet: the 00 / 0 / back row and Add went under it, and taps meant for 0
   * landed on the rows above (a $3.00 typed as $0.03). The output takes no
   * text, so no keyboard; the name and the note raise it only when tapped.
   */
  const amountOf = (panel: HTMLElement | null) =>
    panel?.querySelector<HTMLElement>("[data-amount-pad] output") ?? null;
  useSheetFocus(panelRef, onClose, amountOf);
  /** Done on the keyboard: back to the pad, which puts the keyboard away. */
  const backToPad = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    amountOf(panelRef.current)?.focus();
  };

  const ok = name.trim().length > 0;
  function add() {
    if (!ok) return;
    onAdd({
      name: name.trim(),
      amountCents,
      quantity,
      specialInstructions: note.trim() || undefined,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t("pos.custom.title")}
      data-sheet="custom"
    >
      <button
        aria-hidden="true"
        tabIndex={-1}
        className="absolute inset-0 bg-staff-scrim"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="staff-sheet-in relative z-10 flex max-h-[92svh] w-full max-w-[34rem] flex-col sm:max-w-[46rem] overflow-hidden rounded-t-[24px] bg-staff-bg text-staff-ink shadow-staff-raised sm:rounded-[24px]"
      >
        <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-3">
          <h2 className="flex items-baseline gap-2">
            <span lang="zh-Hant" className="text-[1.364rem] font-bold">
              {t("pos.custom.zh")}
            </span>
            <span lang="en" className="text-base text-staff-soft">
              {t("pos.custom.en")}
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("sheet.close")}
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-staff-soft hover:bg-staff-sunken hover:text-staff-ink"
          >
            <Icon name="x" size={22} />
          </button>
        </div>

        {/* Two columns on a tablet: only the left one (name, chips, note)
            scrolls, so the pad and the footer's Add can never scroll away. */}
        <div className="grid min-h-0 flex-1 gap-x-6 gap-y-4 overflow-y-auto px-6 pt-1 pb-5 sm:grid-cols-2 sm:overflow-visible">
          <div className="flex min-w-0 flex-col gap-4 sm:-mx-1 sm:min-h-0 sm:overflow-y-auto sm:px-1 sm:pb-1">
            <label className="block">
              <span className="mb-2 block text-base font-semibold">
                {t("pos.custom.name")}
              </span>
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={MAX_CHARGE_NAME}
                autoComplete="off"
                enterKeyHint="done"
                onKeyDown={backToPad}
                data-field="custom-name"
                placeholder={t("pos.custom.namePlaceholder")}
                className="min-h-14 w-full rounded-staff-control bg-staff-panel px-4 text-staff-title text-staff-ink shadow-[inset_0_0_0_2px_var(--color-staff-sunken)] outline-none placeholder:text-staff-soft focus-visible:shadow-[inset_0_0_0_2px_var(--color-staff-brand)]"
              />
            </label>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label={t("pos.custom.quick")}
            >
              {CHARGE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  data-preset={p.id}
                  aria-pressed={name.trim() === presetLabel(p)}
                  onClick={() => setName(presetLabel(p))}
                  className={chipClass(name.trim() === presetLabel(p))}
                >
                  <span lang="zh-Hant">{p.zh}</span>
                  <span lang="en" className="font-normal text-staff-soft">
                    {p.en}
                  </span>
                </button>
              ))}
              <button
                type="button"
                data-preset="other"
                onClick={() => {
                  setName("");
                  nameRef.current?.focus();
                }}
                className={chipClass(false)}
              >
                <span lang="zh-Hant">{t("pos.custom.otherZh")}</span>
                <span lang="en" className="font-normal text-staff-soft">
                  {t("pos.custom.otherEn")}
                </span>
              </button>
            </div>

            {noteOpen ? (
              <label className="block">
                <span className="mb-2 block text-base font-semibold">
                  {t("sheet.instructions")}
                </span>
                <textarea
                  ref={noteRef}
                  value={note}
                  maxLength={200}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  enterKeyHint="done"
                  onKeyDown={backToPad}
                  data-field="custom-note"
                  placeholder={t("sheet.instructionsPlaceholder")}
                  className="w-full resize-none rounded-xl bg-staff-panel px-4 py-3 text-base shadow-[inset_0_0_0_2px_var(--color-staff-sunken)] outline-none placeholder:text-staff-soft focus:shadow-[inset_0_0_0_2px_var(--color-staff-brand)]"
                />
              </label>
            ) : (
              <button
                type="button"
                data-action="custom-note-open"
                onClick={() => {
                  setNoteOpen(true);
                  requestAnimationFrame(() => noteRef.current?.focus());
                }}
                className="staff-press flex min-h-11 items-center self-start rounded-xl px-3 text-base font-semibold text-staff-soft hover:bg-staff-sunken hover:text-staff-ink"
              >
                {t("pos.custom.noteAdd")}
              </button>
            )}
          </div>

          <div className="min-w-0">
            <span className="mb-2 block text-base font-semibold">
              {t("pos.custom.amount")}
            </span>
            <AmountPad
              cents={amountCents}
              onChange={setAmountCents}
              label={t("pos.custom.amount")}
            />
          </div>
        </div>

        <div className="flex items-center gap-4 bg-staff-panel px-6 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
          <div
            className="flex items-center gap-1"
            role="group"
            aria-label={t("sheet.quantity")}
          >
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label={t("pos.decrease")}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-staff-sunken text-staff-ink hover:bg-staff-gold-tint"
            >
              <Icon name="minus" size={22} />
            </button>
            <span
              className="w-[2.364rem] text-center text-[1.364rem] font-bold tabular-nums"
              aria-live="polite"
              data-qty
            >
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(50, q + 1))}
              aria-label={t("pos.increase")}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-staff-sunken text-staff-ink hover:bg-staff-gold-tint"
            >
              <Icon name="plus" size={22} />
            </button>
          </div>
          <button
            type="button"
            onClick={add}
            disabled={!ok}
            data-action="sheet-add"
            className="flex h-[4rem] flex-1 items-center justify-between gap-3 rounded-pos bg-staff-brand px-6 text-[1.182rem] font-bold whitespace-nowrap text-staff-on-brand transition-colors hover:bg-staff-brand-hover disabled:cursor-not-allowed disabled:bg-staff-sunken disabled:text-staff-soft"
          >
            <span>
              {ok
                ? editing
                  ? t("sheet.update")
                  : t("sheet.add")
                : t("pos.custom.needsName")}
            </span>
            <span className="tabular-nums">
              {formatCents(amountCents * quantity)}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
