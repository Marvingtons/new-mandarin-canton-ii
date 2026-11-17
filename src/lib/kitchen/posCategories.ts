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

/**
 * THE POS TABS: nine, in one row on an upright iPad. Each groups one or more
 * menu categories into one section of the dish scroll; 常點 Popular is the
 * owner's list (config/posPopular.ts) rather than a menu category.
 */
export type PosTabIcon = "star" | "flame" | "layers" | "drumstick" | "steak" | "fish" | "leaf" | "bowl" | "soup";

export interface PosTab {
  id: string;
  zh: string;
  /** Short enough for a 90px tab at 13px. */
  en: string;
  /** The full name, for assistive tech and the section heading. */
  enFull: string;
  icon: PosTabIcon;
  tint: CategoryTint;
  /** Menu category ids, in order; empty for Popular. */
  categories: readonly string[];
}

export const POPULAR_TAB_ID = "popular";

export const POS_TABS: readonly PosTab[] = [
  { id: POPULAR_TAB_ID, zh: "常點", en: "Popular", enFull: "Popular", icon: "star", tint: "lunch", categories: [] },
  { id: "specials", zh: "招牌", en: "Specials", enFull: "Specials & Sizzling", icon: "flame", tint: "specials", categories: ["specials", "sizzling-hot-pot"] },
  { id: "sets", zh: "套餐", en: "Sets", enFull: "Lunch & Family Sets", icon: "layers", tint: "family", categories: ["lunch-specials", "family-dinners", "big-family-dinner"] },
  { id: "chicken", zh: "雞", en: "Chicken", enFull: "Chicken", icon: "drumstick", tint: "chicken", categories: ["chicken"] },
  { id: "beef-pork", zh: "牛·豬", en: "Beef·Pork", enFull: "Beef & Pork", icon: "steak", tint: "beef", categories: ["beef", "pork"] },
  { id: "seafood", zh: "海鮮", en: "Seafood", enFull: "Seafood", icon: "fish", tint: "seafood", categories: ["seafood"] },
  { id: "veg", zh: "菜·豆腐", en: "Veg·Tofu", enFull: "Vegetables & Tofu", icon: "leaf", tint: "vegetables", categories: ["vegetables"] },
  { id: "rice-noodles", zh: "飯·麵", en: "Rice·Noodle", enFull: "Fried Rice & Noodles", icon: "bowl", tint: "rice", categories: ["fried-rice", "noodles"] },
  { id: "starters", zh: "前·湯", en: "Starters", enFull: "Starters, Soup & Sides", icon: "soup", tint: "appetizers", categories: ["appetizers", "soup", "sides"] },
];

/**
 * A POS name where the menu's own does not tell two cards apart. The two
 * lunch tiers are both "午市套餐 Lunch Special" on the menu; staff need to
 * see which one they are tapping.
 */
const POS_NAMES: Record<string, { zh: string; en: string }> = {
  "combo-lunch-15-75": { zh: "午市套餐 A", en: "Lunch A · with egg roll + wing" },
  "combo-lunch-16-25": { zh: "午市套餐 B", en: "Lunch B · kung pao, wings, chow fun…" },
  // Same 中文 on the menu too; the head count is what tells them apart.
  "combo-big-family-128": { zh: "大家庭 4–6位", en: "Big Family Dinner · 4 to 6 people" },
  "combo-big-family-178": { zh: "大家庭 6–8位", en: "Big Family Dinner · 6 to 8 people" },
};

export function posName(item: { id: string; nameZh: string | null; nameEn: string }): { zh: string | null; en: string } {
  return POS_NAMES[item.id] ?? { zh: item.nameZh, en: item.nameEn };
}

/** The CSS custom property a tinted element reads its colour from. */
export function tintStyle(tint: CategoryTint): React.CSSProperties {
  return { "--c": `var(--cat-${tint})` } as React.CSSProperties;
}
