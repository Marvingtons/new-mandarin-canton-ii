// TODO(confirm): es strings pending native review (Marvin)
//
// Spanish for the PROTEIN / PREPARATION choice options ("Chicken or Beef Chow
// Fun", "Steamed or Fried Dumplings" — see lib/menu/choice.ts).
//
// WHY THESE ARE HERE WHEN DISH NAMES ARE NOT (menu-descriptions-es.ts is
// explicit that names stay untranslated). A protein pick is not a proper-noun
// dish name — it is a decision the customer makes at order time, the same kind
// of counter question "¿pollo o res?" is in Spanish. A Spanish reader hitting a
// required, no-default selector with a disabled Add button benefits from reading
// the options in their language far more than they would from a translated dish
// title.
//
// STAGED, NOT YET RENDERED. The item sheet still shows every choice option as
// "English 中文", exactly like the rice and #116 preparation selectors it sits
// beside — translating one required menu selector and not the others would read
// as a bug. These strings are added and flagged so the native review has them
// ready; wiring them into ItemSheet (and, if the family agrees, the rice/prep
// options too) is a one-line change behind the locale once that review lands.
// verify:choice asserts this map stays in step with the option ids, so it
// cannot silently rot while it waits.
//
// Neighbourhood register, matching menu-descriptions-es.ts: "res" not "carne de
// vaca", "pollo", terse.

import type { Locale } from "@/lib/i18n/locale";

/** Keyed by the choice OPTION id (see lib/menu/choice.ts specs in menu.ts). */
const choiceOptionEs: Record<string, string> = {
  // #124 Chicken or Beef Chow Fun (Dry)
  "chow-fun-chicken": "Pollo",
  "chow-fun-beef": "Res",
  // Specials — Black Pepper Beef or Chicken
  "black-pepper-beef": "Res",
  "black-pepper-chicken": "Pollo",
  // #6 Steamed or Fried Dumplings (8)
  "dumplings-steamed": "Al vapor",
  "dumplings-fried": "Fritos",
};

/**
 * The Spanish label for a choice option, or null when there is none. Falls back
 * to null (the caller keeps the English) rather than guessing — a wrong protein
 * word is not a style problem, the same reasoning menu-descriptions-es.ts uses.
 */
export function choiceOptionLabelEs(optionId: string): string | null {
  return choiceOptionEs[optionId] ?? null;
}

/** The reader's-language label for a choice option: Spanish when we have it and
 *  the locale asks for it, otherwise the English the sheet already shows. */
export function choiceOptionLabel(
  optionId: string,
  englishLabel: string,
  locale: Locale,
): string {
  if (locale === "es") return choiceOptionEs[optionId] ?? englishLabel;
  return englishLabel;
}

/** Every option id that has a staged Spanish label, for the parity check. */
export function choiceOptionEsIds(): string[] {
  return Object.keys(choiceOptionEs);
}

/** How many options are translated, for the report. */
export const CHOICE_ES_COUNT = Object.keys(choiceOptionEs).length;
