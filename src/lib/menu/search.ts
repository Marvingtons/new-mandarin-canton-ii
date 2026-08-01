import type { MenuItem } from "@/lib/menu/types";

/**
 * Menu search: fold a string down to something a typo-tolerant match can
 * work with.
 *
 * NFD then strip the combining marks, so "sauteed" finds "sautéed" and
 * "Szechuan" finds "Széchuan" if it were ever spelled that way. Chula
 * Vista customers type without accents far more often than with them, and
 * a search that cannot find a dish because of an é is a search that looks
 * broken.
 *
 * CJK is left alone by this: NFD does not decompose Han characters, so
 * 宮保雞丁 folds to itself and a customer typing 雞 still matches.
 */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Does this item match the query?
 *
 * Matches the English name, the Chinese name, and the description — the
 * three things actually rendered on a menu row. Every whitespace-separated
 * term must appear somewhere, so "spicy chicken" narrows rather than
 * widening the way a single OR would.
 *
 * Substring rather than word-prefix on purpose: "pao" should find "Kung
 * Pao", and a customer half-remembering a dish is the whole use case.
 */
export function itemMatches(
  item: MenuItem,
  foldedTerms: readonly string[],
  extraHaystack = "",
): boolean {
  if (foldedTerms.length === 0) return true;
  const hay = fold(
    [item.nameEn, item.nameZh ?? "", item.description ?? "", extraHaystack].join(
      " ",
    ),
  );
  return foldedTerms.every((t) => hay.includes(t));
}

/** Split a raw query into folded terms. Empty query = no terms = match all. */
export function queryTerms(query: string): string[] {
  const folded = fold(query);
  return folded.length === 0 ? [] : folded.split(/\s+/).filter(Boolean);
}
