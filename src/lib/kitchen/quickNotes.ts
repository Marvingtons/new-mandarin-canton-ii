/**
 * QUICK NOTES on a POS ticket line, one tap each (tap the line to see them).
 * They are what prints in the line's note, so they are ticket data like the
 * menu's names, not screen chrome, and live here rather than in the kitchen
 * dictionary: the same words print whichever language the screen is in.
 *
 * Every character is in the ticket font (public/fonts/ticket-font-coverage.json),
 * so a note prints as written, never as a box. Check that list before adding
 * one, or run `npm run build:ticket-font` after.
 */
export const QUICK_NOTES: readonly string[] = [
  "走辣 No spicy",
  "加辣 Extra spicy",
  "走味精 No MSG",
  "汁另上 Sauce on side",
  "走蔥 No green onion",
  "走蒜 No garlic",
];

/** Between notes on one line; "·" is in the ticket font, "、" is not. */
export const NOTE_SEP = " · ";

/** The line's note with `note` added, or taken off if it is there. */
export function toggleNote(current: string | undefined, note: string): string | undefined {
  const parts = (current ?? "").split(NOTE_SEP).map((p) => p.trim()).filter(Boolean);
  const next = parts.includes(note) ? parts.filter((p) => p !== note) : [...parts, note];
  return next.length > 0 ? next.join(NOTE_SEP).slice(0, 200) : undefined;
}
