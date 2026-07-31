"use client";

import { useEffect, useMemo, useState } from "react";
import type { MenuItem } from "@/lib/menu/types";
import { itemSizes } from "@/lib/menu/types";
import { resolveLinePrice } from "@/lib/cart/pricing";
import { useCart } from "@/lib/cart/CartContext";
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
  const sizes = itemSizes(item);

  const [sizeId, setSizeId] = useState<string>(sizes[0]?.id ?? "");
  const [selected, setSelected] = useState<Record<string, string[]>>({});
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

  const modifierIds = useMemo(
    () => Object.values(selected).flat(),
    [selected],
  );

  const priceCents = useMemo(() => {
    if (!sizeId) return 0;
    try {
      return resolveLinePrice(item, sizeId, modifierIds, quantity).lineCents;
    } catch {
      return 0;
    }
  }, [item, sizeId, modifierIds, quantity]);

  // Every group's min/max must be satisfied to enable Add.
  const groupsValid = useMemo(() => {
    return item.modifierGroups.every((g) => {
      const count = (selected[g.id] ?? []).length;
      const maxOk = g.maxAllowed == null || count <= g.maxAllowed;
      return count >= g.minRequired && maxOk;
    });
  }, [item, selected]);

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
      <button
        aria-label="Close"
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
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full px-2 text-2xl leading-none text-ink/60 hover:text-ink"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4" data-lenis-prevent>
          {/* Size */}
          {sizes.length > 1 && (
            <fieldset className="mb-5">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-ink/55">
                Size
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

          {/* Modifier groups */}
          {item.modifierGroups.map((g) => (
            <fieldset key={g.id} className="mb-5">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-ink/55">
                {g.nameEn}
                {g.minRequired > 0 && (
                  <span className="ml-1 text-lacquer">· required</span>
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
              Special instructions
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
              placeholder="e.g. extra spicy, sauce on the side"
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
                Allergies: please call us instead
              </span>{" "}
              <span lang="zh-Hant" className="font-chinese">
                · 過敏請致電
              </span>
              . This note only reaches the kitchen when your ticket prints.
            </p>
          </div>
        </div>

        {/* Footer: quantity + add */}
        <div className="flex items-center gap-3 border-t border-gold/30 px-5 py-4">
          {/* Corners on the buttons, not a clip on the wrapper — see the
              same stepper in CartDrawer for why. */}
          <div className="flex items-center rounded-sm border border-gold/50">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label="Decrease quantity"
              className="min-h-11 w-11 rounded-l-sm text-xl text-ink hover:bg-gold/10"
            >
              −
            </button>
            <span className="w-8 text-center font-semibold text-ink" aria-live="polite">
              {quantity}
            </span>
            <button
              onClick={() => setQuantity((q) => q + 1)}
              aria-label="Increase quantity"
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
            <span>Add to Cart</span>
            <span aria-hidden="true">·</span>
            <span>{formatCents(priceCents)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
