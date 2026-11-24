/**
 * The preparation choice's ids, in a leaf module with no imports, so client
 * code (the POS tap rule) can name them without pulling in preparation.ts and
 * the whole menu data it imports. preparation.ts re-exports these.
 */
export const PREP_GROUP_ID = "prep";
export const PREP_STEAMED_ID = "prep-steamed";
export const PREP_FRIED_ID = "prep-fried";
