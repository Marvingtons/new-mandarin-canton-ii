"use client";

import { useEffect, useMemo, useState } from "react";
import type { MenuItem } from "@/lib/menu/types";
import { itemSizes } from "@/lib/menu/types";
import { groupsForSize } from "@/lib/menu/rice";
import { resolveLinePrice } from "@/lib/cart/pricing";
import { useCart } from "@/lib/cart/CartContext";
import { useT } from "@/lib/i18n/LocaleContext";
import { formatCents } from "@/lib/money";

const MAX_INSTRUCTIONS = 200;

/**
 * Item detail sheet — modal on desktop, bottom sheet on mobile. Size toggle,
 * modifier groups (min/max enforced), quantity stepper, special instructions,
 * and an Add button whose price updates live. Everything is PICKUP.
 *
 * The wrapper handles the null case and keys the inner sheet by item id, so a
 * fresh item remounts with clean state (no reset-in-effect needed).
 */
export default function ItemSheet({
  item,
  onClose,
}: {
  item: MenuItem | null;
  onClose: () => void;
}) {
  if (!item) return null;
  return <ItemSheetInner key={item.id} item={item} onClose={onClose} />;
}

function ItemSheetInner({
  item,
  onClose,
}: {
  item: MenuItem;
  onClose: () => void;
}) {
  const { addItem } = useCart();
  const t = useT();
  const sizes = itemSizes(item);

  const [sizeId, setSizeId] = useState<string>(sizes[0]?.id ?? "");
  /**
   * Single-choice REQUIRED groups open on their first option.
   *
   * Sizes have always defaulted to the first tier; modifier groups never
   * did, which was invisible while the only required group was the lunch
   * entrée choice — a genuine decision, where a default would be the
   * kitchen picking your lunch. Rice is not that. It is on most of the
   * menu, steamed is what the counter gives you if you say nothing, and
   * an undefaulted required group means every dish opens with a dead Add
   * to Cart button and no visible reason.
   *
   * Only `maxAllowed === 1` groups: defaulting one option of a
   * multi-select would be choosing on the customer's behalf, not saving
   * them a tap. A lazy initializer, so it costs one evaluation at mount
   * and needs no effect.
   */
  const [selected, setSelected] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const g of item.modifierGroups) {
      if (g.minRequired >= 1 && g.maxAllowed === 1 && g.modifiers[0]) {
        initial[g.id] = [g.modifiers[0].id];
      }
    }
    return initial;
  });
  const [quantity, setQuantity] = useState(1);
  const [instructions, setInstructions] = useState("");

  // Escape closes (event subscription — no state reset here).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * The groups this SIZE offers. A party tray has no rice group: rice
   * comes with an individual portion, and a tray is the dish alone.
   */
  const groups = useMemo(() => groupsForSize(item, sizeId), [item, sizeId]);

  /**
   * The pending line's modifiers, filtered to what the current size
   * actually offers.
   *
   * The filter is what implements "Individual → Tray drops the rice".
   * `selected` is deliberately NOT cleared when the size changes — it
   * keeps remembering, so Tray → Individual brings the selector back with
   * the choice still on it (Steamed on a sheet nobody has touched, which
   * is the initializer's default; whatever they picked if they did). A
   * reset would punish toggling a size for a look at the price, and the
   * thing that actually matters — that no rice can reach the cart on a
   * tray line — is this filter, not the state.
   */
  const modifierIds = useMemo(() => {
    const offered = new Set(groups.flatMap((g) => g.modifiers.map((m) => m.id)));
    return Object.values(selected)
      .flat()
      .filter((id) => offered.has(id));
  }, [selected, groups]);

  const priceCents = useMemo(() => {
    if (!sizeId) return 0;
    try {
      return resolveLinePrice(item, sizeId, modifierIds, quantity).lineCents;
    } catch {
      return 0;
    }
  }, [item, sizeId, modifierIds, quantity]);

  /** Groups that are not yet satisfied, so the footer can name them. */
  const unmetGroups = useMemo(
    () =>
      groups.filter((g) => {
        const count = (selected[g.id] ?? []).length;
        const maxOk = g.maxAllowed == null || count <= g.maxAllowed;
        return !(count >= g.minRequired && maxOk);
      }),
    [groups, selected],
  );

  // Every group's min/max must be satisfied to enable Add.
  const groupsValid = unmetGroups.length === 0;

  /**
   * The unmet-group notice keeps its emphasised group names, so the
   * sentence is split on its {groups} placeholder rather than
   * interpolated — Spanish does not put the clause where English does,
   * and the two halves have to follow the translation, not the markup.
   */
  const [chooseBefore, chooseAfter] = t("sheet.chooseToAdd").split("{groups}");

  function toggleModifier(groupId: string, modId: string, maxAllowed: number | null) {
    setSelected((prev) => {
      const current = prev[groupId] ?? [];
      const has = current.includes(modId);
      if (has) return { ...prev, [groupId]: current.filter((id) => id !== modId) };
      // Single-select group: replace. Multi-select: append up to max.
      if (maxAllowed === 1) return { ...prev, [groupId]: [modId] };
      if (maxAllowed != null && current.length >= maxAllowed) return prev;
      return { ...prev, [groupId]: [...current, modId] };
    });
  }

  function handleAdd() {
    if (!groupsValid) return;
    addItem({
      itemId: item.id,
      sizeId,
      modifierIds,
      quantity,
      specialInstructions: instructions.trim() || undefined,
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={item.nameEn}
    >
      {/* THE SCRIM IS NOT ANNOUNCED. It is a full-screen button, so with an
          accessible name it put a second control called "Close" in the
          dialog — one of them invisible and the size of the viewport — and a
          screen reader offered both. Tapping outside still closes; Escape
          and the × below are the ways a keyboard or screen-reader user does
          it, and they are enough. */}
      <button
        aria-hidden="true"
        tabIndex={-1}
        className="absolute inset-0 bg-ink/60"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[90svh] w-full max-w-lg flex-col overflow-hidden rounded-t-lg bg-cream shadow-xl sm:rounded-lg">
        <div className="flex items-start justify-between gap-4 border-b border-gold/30 px-5 py-4">
          <div>
            <h2 className="font-display text-2xl text-ink">{item.nameEn}</h2>
            {item.description && (
              <p className="mt-1 text-sm text-ink/70">{item.description}</p>
            )}
          </div>
          {/* h-11 w-11 — see the identical × in CartDrawer. -mr-2 keeps
              the glyph on the optical margin the px-2 version sat on. */}
          <button
            onClick={onClose}
            aria-label={t("sheet.close")}
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl leading-none text-ink/60 hover:text-ink"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4" data-lenis-prevent>
          {/* Size */}
          {sizes.length > 1 && (
            <fieldset className="mb-5">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-ink/55">
                {t("sheet.size")}
              </legend>
              <div className="grid gap-2">
                {sizes.map((s) => (
                  <label
                    key={s.id}
                    className={`flex cursor-pointer items-center justify-between rounded-md border px-4 py-3 ${
                      sizeId === s.id
                        ? "border-lacquer bg-lacquer/5"
                        : "border-gold/40 hover:border-gold"
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="size"
                        className="accent-lacquer"
                        checked={sizeId === s.id}
                        onChange={() => setSizeId(s.id)}
                      />
                      <span className="text-ink">
                        {s.label}
                        {s.servesNote && (
                          <span className="ml-1 text-sm text-ink/55">
                            · {s.servesNote}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="font-semibold text-lacquer">
                      {formatCents(s.priceCents)}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {/* Modifier groups — the ones this SIZE offers. Choosing Party
              Tray takes the rice selector off the sheet entirely; there is
              no disabled state, because the choice does not exist for a
              tray rather than being unavailable. */}
          {groups.map((g) => (
            <fieldset key={g.id} className="mb-5">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-ink/55">
                {g.nameEn}
                {g.minRequired > 0 && (
                  <span className="ml-1 text-lacquer">
                    · {t("sheet.required")}
                  </span>
                )}
              </legend>
              <div className="grid gap-2">
                {g.modifiers.map((m) => {
                  const checked = (selected[g.id] ?? []).includes(m.id);
                  return (
                    <label
                      key={m.id}
                      className={`flex cursor-pointer items-center justify-between rounded-md border px-4 py-2.5 ${
                        checked
                          ? "border-lacquer bg-lacquer/5"
                          : "border-gold/40 hover:border-gold"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type={g.maxAllowed === 1 ? "radio" : "checkbox"}
                          name={`group-${g.id}`}
                          className="accent-lacquer"
                          checked={checked}
                          onChange={() =>
                            toggleModifier(g.id, m.id, g.maxAllowed)
                          }
                        />
                        <span className="text-ink">
                          {m.nameEn}
                          {/* 中文 beside the English on every option that
                              has it. The rice choice is the reason —
                              "Steamed Rice 白飯" is how the menu says it
                              and how the ticket prints it — and the lunch
                              entrée choices get the same treatment for
                              free, which is the right answer on a site
                              whose identity is Chinese-forward. */}
                          {m.nameZh && (
                            <span
                              lang="zh-Hant"
                              className="ml-1.5 font-chinese text-sm text-ink/60"
                            >
                              {m.nameZh}
                            </span>
                          )}
                          {m.note && (
                            <span className="ml-1 text-sm text-ink/55">
                              · {m.note}
                            </span>
                          )}
                        </span>
                      </span>
                      {m.priceCents > 0 && (
                        <span className="text-sm text-ink/70">
                          +{formatCents(m.priceCents)}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}

          {/* Special instructions */}
          <div className="mb-2">
            <label
              htmlFor="special-instructions"
              className="mb-2 block text-xs font-semibold uppercase tracking-[0.15em] text-ink/55"
            >
              {t("sheet.specialInstructions")}
            </label>
            <textarea
              id="special-instructions"
              value={instructions}
              maxLength={MAX_INSTRUCTIONS}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              // WAS "e.g. no peanuts, extra spicy". The site now tells
              // people, twice, that an order note is not a safe way to
              // report an allergy — and the placeholder in the very box
              // it is talking about was suggesting they use it for
              // exactly that. An example is an instruction.
              placeholder={t("sheet.instructionsPlaceholder")}
              className="w-full resize-none rounded-sm border border-gold/40 bg-ivory px-3 py-2 text-sm text-ink outline-none focus:border-lacquer"
            />
            <p className="mt-1 text-right text-xs text-ink/45">
              {instructions.length}/{MAX_INSTRUCTIONS}
            </p>
            {/* Beside the box itself, because this is the one place on the
                site where somebody is actively typing the thing we need
                them not to rely on. */}
            <p className="mt-1 text-xs leading-relaxed text-ink/60">
              <span className="font-semibold text-lacquer">
                {t("sheet.allergyCall")}
              </span>{" "}
              <span lang="zh-Hant" className="font-chinese">
                · {t("sheet.allergyCallZh")}
              </span>
              . {t("sheet.allergyNote")}
            </p>
          </div>
        </div>

        {/* Footer: quantity + add.
            A disabled Add to Cart used to be its own explanation, which it
            never was. Now that most of the menu carries a required group,
            an unmet one is named here rather than leaving a dead button at
            the bottom of a sheet whose fieldsets have scrolled away. */}
        {!groupsValid && (
          <p
            role="status"
            className="border-t border-gold/30 bg-gold/5 px-5 py-2.5 text-sm text-ink/75"
          >
            {chooseBefore}
            <span className="font-semibold text-lacquer">
              {unmetGroups
                .map((g) => g.nameEn.toLowerCase())
                .join(` ${t("ui.and")} `)}
            </span>
            {chooseAfter}
          </p>
        )}
        {/* On a phone this sheet is `items-end`, so the Add bar ends at the
            physical bottom edge and iOS draws the home indicator across
            it. env() adds that strip and is 0px on hardware without one. */}
        <div className="flex items-center gap-3 border-t border-gold/30 px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
          {/* Corners on the buttons, not a clip on the wrapper — see the
              same stepper in CartDrawer for why. */}
          <div className="flex items-center rounded-sm border border-gold/50">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label={t("sheet.decreaseQty")}
              className="min-h-11 w-11 rounded-l-sm text-xl text-ink hover:bg-gold/10"
            >
              −
            </button>
            <span className="w-8 text-center font-semibold text-ink" aria-live="polite">
              {quantity}
            </span>
            <button
              onClick={() => setQuantity((q) => q + 1)}
              aria-label={t("sheet.increaseQty")}
              className="min-h-11 w-11 rounded-r-sm text-xl text-ink hover:bg-gold/10"
            >
              +
            </button>
          </div>
          <button
            onClick={handleAdd}
            disabled={!groupsValid}
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-lacquer px-5 font-semibold text-ivory transition-colors hover:bg-lacquer-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>{t("sheet.addToCart")}</span>
            <span aria-hidden="true">·</span>
            <span>{formatCents(priceCents)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
