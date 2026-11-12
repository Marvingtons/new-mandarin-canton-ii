/**
 * How the POS shows a menu category: its tint, and the short rail label where
 * the menu's own name is too long for a 176px row or has no 中文.
 *
 * COLOUR IS FOR FINDING. Each category has one light tint (the --cat-* tokens
 * in components/kitchen/pos.module.css) that fills its dish tiles; the rail
 * swatch and the stripe on each ticket line are a deeper mark of the same hue,
 * so a dish is found by colour before it is read (docs/kitchen-design.md,
 * Revision 2).
 *
 * The labels are display data like the menu's, not UI chrome, so they live
 * here and not in the kitchen dictionary. A category not listed falls back to
 * the menu's own names and the neutral tint.
 */

export type CategoryTint =
  | "lunch"
  | "specials"
  | "appetizers"
  | "soup"
  | "chicken"
  | "seafood"
  | "beef"
  | "pork"
  | "sizzling"
  | "vegetables"
  | "rice"
  | "noodles"
  | "sides"
  | "family"
  | "bigfamily";

interface PosCategory {
  tint: CategoryTint;
  /** Rail and section heading, when the menu's name does not fit or is missing. */
  zh?: string;
  en?: string;
}

const POS_CATEGORIES: Record<string, PosCategory> = {
  specials: { tint: "specials", zh: "招牌菜" },
  appetizers: { tint: "appetizers" },
  soup: { tint: "soup" },
  chicken: { tint: "chicken" },
  seafood: { tint: "seafood" },
  beef: { tint: "beef" },
  pork: { tint: "pork" },
  "sizzling-hot-pot": { tint: "sizzling", zh: "鐵板", en: "Hot Pot" },
  vegetables: { tint: "vegetables" },
  "fried-rice": { tint: "rice" },
  noodles: { tint: "noodles" },
  sides: { tint: "sides" },
  "lunch-specials": { tint: "lunch", zh: "午餐" },
  "family-dinners": { tint: "family", zh: "家庭餐" },
  "big-family-dinner": { tint: "bigfamily", zh: "大家庭", en: "Big Family" },
};

export interface CategoryLook {
  tint: CategoryTint;
  zh: string | null;
  en: string;
}

export function categoryLook(category: { id: string; nameZh: string | null; nameEn: string }): CategoryLook {
  const c = POS_CATEGORIES[category.id];
  return {
    tint: c?.tint ?? "sides",
    zh: c?.zh ?? category.nameZh,
    en: c?.en ?? category.nameEn,
  };
}

/** The CSS custom property a tinted element reads its colour from. */
export function tintStyle(tint: CategoryTint): React.CSSProperties {
  return { "--c": `var(--cat-${tint})` } as React.CSSProperties;
}
