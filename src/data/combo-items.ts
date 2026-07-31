import { combos, dishZh } from "@/data/menu";
import type { LunchChoice } from "@/data/menu";
import { resolveModifierZh } from "@/data/menu-overrides";
import type { MenuItem, MenuModifier, MenuSize } from "@/lib/menu/types";

/**
 * The printed menu's combo panels, as ORDERABLE items.
 *
 * `src/data/menu.ts` already carries lunch specials, family dinners, and the
 * big family specials — but only as display copy for the /menu page. They were
 * never addable to a cart, which meant a whole column of the physical menu
 * could not be ordered for takeout. This module is the bridge: same source
 * data, mapped into the MenuItem shape the cart, the price recompute, and the
 * ticket all already speak.
 *
 * Nothing here invents a price. Every figure is read from `combos`, which was
 * transcribed from the printed menu (rev. 9/25).
 *
 * HOW EACH IS MODELLED
 *
 *  - LUNCH SPECIALS — one item per price tier, with a REQUIRED single-select
 *    modifier group carrying that tier's entrée list. That is exactly what the
 *    printed menu describes ("choose one"), and it means the entrée choice
 *    reaches the kitchen ticket as a modifier line rather than as free text.
 *    Flagged `lunchSpecial` so the 11–3 gate can find them.
 *
 *    LUNCH PRICE IS THE TIER PRICE. The entrée modifiers are all priceCents 0,
 *    so a lunch line costs $15.75 or $16.25 per person and NOTHING else — the
 *    dinner à-la-carte price of the same-named dish can never reach it. There
 *    is no link from an entrée name to a catalogue item, by design.
 *
 *  - FAMILY DINNERS — per-person prices become SIZES: "2 people" through
 *    "6 people" at perPerson × count. The menu prices them per head with a
 *    two-person minimum, and a size tier is the one part of the existing model
 *    that already means "same dish, different quantity and price". No
 *    configurator, no new concept.
 *
 *  - BIG FAMILY DINNERS — flat price, so a plain single-size item each. They
 *    stay two separate items rather than two sizes of one, because the two
 *    sets contain DIFFERENT dishes (Chef's Scallop vs the deep-fried shrimp).
 */

const LUNCH_CATEGORY = "lunch-specials";
const FAMILY_CATEGORY = "family-dinners";
const BIG_FAMILY_CATEGORY = "big-family-dinner";

/** Family dinners are priced per head from two people up. */
const FAMILY_MIN_PEOPLE = 2;
const FAMILY_MAX_PEOPLE = 6;

/**
 * The printed menu's "Except Noodle & Rice" rule, shown against the entrées it
 * applies to. Display only — see MenuModifier.note.
 */
const NO_RICE_SIDE_NOTE = "no rice side";

/** kebab-case id from a dish name. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * An entrée choice as a free modifier.
 *
 * 中文 is read from the SAME catalogue row the à la carte item reads, so "Kung
 * Pao Chicken" on a lunch special prints the same 宮保雞丁 it prints as its own
 * dish. No second translation to keep in sync — `dishZh` also carries the
 * aliases for the spellings this column of the printed menu abbreviates.
 */
function choiceModifier(choice: LunchChoice): MenuModifier {
  const { name } = choice;
  return {
    id: slug(name),
    nameEn: name,
    nameZh: resolveModifierZh(name) ?? dishZh(name),
    // Zero, always: the tier price is the price of a lunch special.
    priceCents: 0,
    note: choice.noRiceSide ? NO_RICE_SIDE_NOTE : undefined,
  };
}

/**
 * The tier's included sides, as one sentence.
 *
 * Soup is dropped rather than described, because every online order is to-go
 * and the printed menu's own parenthetical says the soup does not travel.
 * Listing it and then retracting it is how a customer ends up expecting soup.
 */
function lunchSidesSentence(sides: string[]): string {
  const travelling = sides.filter((s) => !/soup/i.test(s));
  const included = travelling.length
    ? `Includes ${travelling.join(", ")}. `
    : "";
  return `${included}Soup is not included on to-go orders.`;
}

function lunchItems(): MenuItem[] {
  const section = combos.find((c) => c.id === LUNCH_CATEGORY);
  if (!section) return [];

  return section.sets.map((set) => ({
    id: `combo-${set.id}`,
    // The printed menu titles these by price; "Lunch Special" reads better in
    // a cart, with the included sides as the subtitle.
    nameEn: "Lunch Special",
    // TODO(confirm): descriptive translation, family to approve
    nameZh: "午市套餐",
    description: lunchSidesSentence(set.sides ?? []),
    priceCents: set.priceCents,
    categoryId: LUNCH_CATEGORY,
    modifierGroups: (set.choices ?? []).length
      ? [
          {
            id: `${set.id}-entree`,
            nameEn: "Choose your entrée",
            // TODO(confirm): descriptive translation, family to approve
            nameZh: "選主菜",
            minRequired: 1,
            maxAllowed: 1,
            modifiers: (set.choices ?? []).map(choiceModifier),
          },
        ]
      : [],
    spicy: false,
    vegetarian: false,
    chefSpecial: false,
    available: true,
    lunchSpecial: true,
  }));
}

function familySizes(perPersonCents: number): MenuSize[] {
  const sizes: MenuSize[] = [];
  for (let people = FAMILY_MIN_PEOPLE; people <= FAMILY_MAX_PEOPLE; people++) {
    sizes.push({
      id: `people-${people}`,
      label: `${people} people`,
      priceCents: perPersonCents * people,
      servesNote: `feeds ${people}`,
    });
  }
  return sizes;
}

function familyItems(): MenuItem[] {
  const section = combos.find((c) => c.id === FAMILY_CATEGORY);
  if (!section) return [];

  return section.sets.map((set, i) => {
    const courses = (set.courses ?? [])
      .map((c) => `${c.label}: ${c.value}`)
      .join(" · ");
    // The add-ons are what each extra head brings with them, so they read as
    // part of the description rather than as a choice.
    const addOns = (set.addOns ?? [])
      .map((a) => `${a.label}, add ${a.dish}`)
      .join(" · ");

    return {
      id: `combo-${set.id}`,
      nameEn: set.name,
      // TODO(confirm): descriptive translation, family to approve
      nameZh: i === 0 ? "家庭套餐一" : "家庭套餐二",
      description: [courses, addOns].filter(Boolean).join(". ") || null,
      // Base price is the two-person minimum; sizes carry the real tiers.
      priceCents: set.priceCents * FAMILY_MIN_PEOPLE,
      sizes: familySizes(set.priceCents),
      categoryId: FAMILY_CATEGORY,
      modifierGroups: [],
      spicy: false,
      vegetarian: false,
      chefSpecial: false,
      available: true,
      longPrep: true,
    };
  });
}

function bigFamilyItems(): MenuItem[] {
  const section = combos.find((c) => c.id === BIG_FAMILY_CATEGORY);
  if (!section) return [];

  return section.sets.map((set) => ({
    id: `combo-${set.id}`,
    nameEn: `Big Family Dinner · ${set.name}`,
    // TODO(confirm): descriptive translation, family to approve
    nameZh: "大家庭套餐",
    description: (set.dishes ?? []).join(" · ") || null,
    priceCents: set.priceCents,
    categoryId: BIG_FAMILY_CATEGORY,
    modifierGroups: [],
    spicy: false,
    vegetarian: false,
    chefSpecial: false,
    available: true,
    longPrep: true,
  }));
}

export interface ComboCategorySeed {
  id: string;
  nameEn: string;
  nameZh: string | null;
  note: string | null;
  items: MenuItem[];
}

/** The three combo sections, as orderable categories. */
export function comboCategories(): ComboCategorySeed[] {
  const noteFor = (id: string) => combos.find((c) => c.id === id)?.note ?? null;

  return [
    {
      id: LUNCH_CATEGORY,
      nameEn: "Lunch Specials",
      nameZh: "午市套餐",
      note: noteFor(LUNCH_CATEGORY),
      items: lunchItems(),
    },
    {
      id: FAMILY_CATEGORY,
      nameEn: "Family Dinners",
      nameZh: "家庭套餐",
      note: noteFor(FAMILY_CATEGORY),
      items: familyItems(),
    },
    {
      id: BIG_FAMILY_CATEGORY,
      nameEn: "Big Family Dinner Special",
      nameZh: "大家庭套餐",
      note: noteFor(BIG_FAMILY_CATEGORY),
      items: bigFamilyItems(),
    },
  ].filter((c) => c.items.length > 0);
}
