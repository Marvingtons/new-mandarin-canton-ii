/**
 * THE POS'S CUSTOM CHARGE: a line staff name and price themselves (自訂
 * Custom), and a surcharge on a dish line (加價 Add charge), so "shrimp fried
 * rice, extra shrimp +$3" stays one line.
 *
 * THE ONE PLACE A PRICE IS TYPED. Every other line is priced by the server
 * from the menu, and the web checkout still has no field that can carry
 * money. The staff schema alone takes `amountCents` here, because the owner
 * asked for it (2026-11-20): the counter charges for things the menu does not
 * list. The server still does the arithmetic (amount x quantity, the tax), and
 * the ticket, the board and history read the stored line like any other.
 *
 * NO SCHEMA CHANGE. A custom line is an ordinary OrderLine in the `items`
 * jsonb with `custom: true` and the item id "custom"; a surcharge is one more
 * entry in the line's `modifiers` (id "surcharge"), whose price the line's
 * unit price already includes.
 *
 * Pure: the POS, the order route and the scripts all read it.
 */

import type { OrderLine, OrderLineModifier } from "@/lib/orders/types";

/** The item id every custom line carries. No menu item has it. */
export const CUSTOM_ITEM_ID = "custom";
/** The modifier id a surcharge is stored under. No menu modifier has it. */
export const SURCHARGE_MODIFIER_ID = "surcharge";

/** $1,000.00: far past anything the counter charges, short of a typo's reach. */
export const MAX_CHARGE_CENTS = 100_000;
export const MAX_CHARGE_NAME = 40;

/** Per tablet: the last name used, which the sheet opens on. */
export const CUSTOM_NAME_STORAGE_KEY = "nmc-pos-custom-name";

/**
 * The quick names, 中文 and English. "其他 Other" is not a name: it clears the
 * field for typing. No 加飯 Extra rice: rice is the menu item #116 on its own
 * line (the POS's 加飯 button and the 改 sheet's 加飯 row), so there is one way
 * to charge for it, at the menu's price. Every 中文 here is already in the
 * ticket font's subset.
 */
export interface ChargePreset {
  id: string;
  zh: string;
  en: string;
}
export const CHARGE_PRESETS: readonly ChargePreset[] = [
  { id: "extra-shrimp", zh: "加蝦", en: "Extra shrimp" },
  { id: "extra-meat", zh: "加肉", en: "Extra meat" },
  { id: "extra-spicy", zh: "加辣", en: "Extra spicy" },
];

/** How a preset reads in the name field, and is sent to the server. */
export function presetLabel(p: ChargePreset): string {
  return `${p.zh} ${p.en}`;
}

/**
 * The stored names for what staff typed. A preset (typed or tapped) splits
 * into its 中文 and English, which print on two lines like a dish; anything
 * else is kept as typed, as the English line, the way a note is.
 */
export function chargeNames(raw: string): { nameEn: string; nameZh: string | null } {
  const text = raw.trim().replace(/\s+/g, " ");
  const preset = CHARGE_PRESETS.find(
    (p) => text === presetLabel(p) || text === p.zh || text.toLowerCase() === p.en.toLowerCase(),
  );
  if (preset) return { nameEn: preset.en, nameZh: preset.zh };
  return { nameEn: text, nameZh: null };
}

/** What a surcharge looks like on a draft line and on the wire. */
export interface Surcharge {
  amountCents: number;
  label: string;
}

/** The stored modifier for a surcharge. */
export function surchargeModifier(s: Surcharge): OrderLineModifier {
  const { nameEn, nameZh } = chargeNames(s.label);
  return { id: SURCHARGE_MODIFIER_ID, nameEn, nameZh, priceCents: s.amountCents };
}

/** A custom line as stored: an ordinary line, flagged. */
export function customOrderLine(input: {
  name: string;
  amountCents: number;
  quantity: number;
  specialInstructions?: string;
}): OrderLine {
  const { nameEn, nameZh } = chargeNames(input.name);
  const quantity = Math.max(1, Math.floor(input.quantity));
  return {
    itemId: CUSTOM_ITEM_ID,
    nameEn,
    nameZh,
    sizeId: "regular",
    sizeLabel: "Regular",
    sizeLabelZh: null,
    modifiers: [],
    quantity,
    unitCents: input.amountCents,
    lineCents: input.amountCents * quantity,
    specialInstructions: input.specialInstructions,
    custom: true,
  };
}

/** A line that came back from storage: is it a custom one? */
export function isCustomLine(line: Pick<OrderLine, "itemId"> & { custom?: boolean }): boolean {
  return line.custom === true || line.itemId === CUSTOM_ITEM_ID;
}

/**
 * Keypad entry, cents first: each digit shifts in from the right, so 3, 0, 0
 * reads $3.00 and 0 alone stays $0.00 (a free line is allowed).
 */
export function pressKey(cents: number, key: string): number {
  if (key === "back") return Math.floor(cents / 10);
  if (key === "clear") return 0;
  if (key === "00") return pressKey(pressKey(cents, "0"), "0");
  if (!/^\d$/.test(key)) return cents;
  const next = cents * 10 + Number(key);
  return next > MAX_CHARGE_CENTS ? cents : next;
}
