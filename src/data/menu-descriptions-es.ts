// TODO(confirm): es strings pending native review (Marvin)
//
// Spanish for the SPECIALS blurbs only.
//
// DISH NAMES ARE NOT HERE AND WILL NOT BE. "Kung-Po San Shein" and
// 宮保三鮮 are what the dish is called — they function as proper nouns, the
// kitchen ticket prints them, and a customer pointing at the printed menu
// at the counter has to be pointing at the same words. Translating a name
// would put a third label on a dish that already has two.
//
// The blurbs are different: they are a description of what is in the bowl,
// and a Spanish-reading customer deciding between the duck one and the
// seafood one needs to be able to read them.
//
// Ingredient nouns are the neighbourhood's, not the dictionary's:
// "camarón" not "gamba", "castañas de agua", "chícharos chinos" for snow
// peas, "cebollín" for the green onion. Kept as terse comma lists, the
// way the printed menu writes them.

import type { Locale } from "@/lib/i18n/locale";

/**
 * Keyed by the `src/data/menu.ts` item id. An id with no entry simply
 * renders its English description, which is the honest behaviour for a
 * dish nobody has translated yet — better than a machine guess about
 * food, where a wrong ingredient is not a style problem.
 */
const specialsEs: Record<string, string> = {
  "mandarin-special":
    "Pato, camarón, pollo, puerco asado, brócoli, champiñones, castañas de agua, chícharos chinos y la salsa especial del chef.",
  oceania:
    "Camarón, callo de hacha, calamar, filete de pescado, champiñones, chícharos chinos y verduras.",
  "orange-flavored-chicken-special": "Salsa especial de mandarina del chef.",
  "salted-pepper-chicken-wings-special":
    "Fritas y crujientes, salteadas con chile.",
  "kung-po-san-shein":
    "Camarón, pollo, res, cebollín, cacahuates y salsa picante.",
  "mongolian-beef-special":
    "Filete en rebanadas, cebollín verde y salsa natural.",
  "upside-down-pan-fried-noodles": "Res, pollo, camarón y verduras.",
  "honey-walnut-shrimp": "Aderezo especial de mayonesa con nuez a la miel.",
};

/**
 * The description to render for an item, in the reader's language.
 *
 * Falls back to the English description rather than to an empty string:
 * a missing translation should cost the reader nothing they had before.
 */
export function describeItem(
  itemId: string,
  englishDescription: string | null,
  locale: Locale,
): string | null {
  if (locale === "es") return specialsEs[itemId] ?? englishDescription;
  return englishDescription;
}

/** How many blurbs are translated, for the report. */
export const SPECIALS_ES_COUNT = Object.keys(specialsEs).length;
