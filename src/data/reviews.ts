/**
 * Homepage review quotes ("Kind Words" section).
 *
 * The bracketed markers below ship VISIBLE by design — paste the real
 * Google reviews over them (keep them short, one to two sentences).
 * Do not write review copy by hand; only real customer words go here.
 */

export type Review = {
  id: string;
  quote: string;
  /** e.g. "— R.C., Google" once real reviews are pasted in. */
  attribution: string | null;
};

export const reviews: Review[] = [
  {
    id: "egg-drop-soup",
    quote: "[PASTE REAL GOOGLE REVIEW — egg drop soup]",
    attribution: null,
  },
  {
    id: "longtime-customer",
    quote: "[PASTE REAL GOOGLE REVIEW — longtime customer]",
    attribution: null,
  },
  {
    id: "service-value",
    quote: "[PASTE REAL GOOGLE REVIEW — service/value]",
    attribution: null,
  },
];
