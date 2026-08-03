import { menu } from "@/data/menu";

/**
 * The house favourites, as ONE list.
 *
 * This used to be a positional slice computed inline inside
 * FavoritesSpotlight — `menu.find(c => c.id === "specials").items.slice(0,
 * 6)` — which made "which dishes are the favourites" an answer you could
 * only get by reading a carousel component, and made it impossible for a
 * second surface to show the same six without either importing a client
 * component or writing the list down again.
 *
 * The ids are LITERAL now rather than positional. A slice quietly changes
 * meaning when someone reorders the Specials column of the printed menu:
 * the homepage would start advertising different dishes with no diff to
 * review. These six were the first six at the time of extraction, so the
 * homepage renders exactly what it rendered before, but from now on
 * changing the set is an edit to this array and shows up in a commit.
 *
 * NOT derived from `chefSpecial` or a tag: no such marker data exists for
 * these items today, and inventing one would change what the homepage
 * shows as a side effect of a refactor.
 */
/**
 * ⚠️ THE SET IS NOW "THE DISHES WE HAVE A PHOTOGRAPH OF", and that is a
 * curation rule rather than a coincidence of what got shot.
 *
 * It was six, chosen from the top of the printed menu's Specials column,
 * and only one of them had ever been photographed. The homepage therefore
 * opened on three empty placeholder frames and the one real dish photo on
 * the site was on card four, reachable by clicking an arrow twice. A
 * spotlight whose default state is three grey rectangles is not a
 * spotlight.
 *
 * So the list is inverted: a dish earns a place here by having a picture,
 * and the section shows all of them at once (see FavoritesSpotlight — the
 * carousel is gone). Order is deliberate, not alphabetical:
 *
 *   1. salted pepper wings — the house signature, and the dish the hero
 *      video closes on, plated on the same blue-and-white china. First
 *      thing a visitor sees and first dish they see, matching.
 *   2. honey walnut shrimp — the strongest of the three as a photograph.
 *   3. house soft noodle — the everyday order, and the only one of the
 *      three that is not in Specials.
 *
 * WHAT CAME OUT: mandarin-special, oceania, orange-flavored-chicken-special,
 * kung-po-san-shein, mongolian-beef-special. Every one of them is still a
 * normal orderable menu item and nothing about the menu changed — this
 * list only decides what the SPOTLIGHT features. They come back the day
 * they are photographed, one line each, and the photo slots for two of
 * them are already sitting in data/images.ts waiting.
 *
 * The three photographed dishes are the whole of what the folder supports.
 * The dining-room photograph has no dish in it that could be cropped out
 * cleanly — the nearest tables show guests, a cake box and a bag of
 * greens — and the hero poster is the same wings dish the first card
 * already carries, from a worse angle.
 */
export const favoriteItemIds = [
  "salted-pepper-chicken-wings-special",
  "honey-walnut-shrimp",
  "house-soft-noodle",
] as const;

export type FavoriteItemId = (typeof favoriteItemIds)[number];

/** A favourite, joined to the menu category it lives in. */
export interface FavoriteEntry {
  item: (typeof menu)[number]["items"][number];
  /** The category's id, e.g. "specials" — the anchor the card links to. */
  categoryId: string;
}

/**
 * The raw catalogue rows for the favourites, in listed order, each with the
 * category it came from.
 *
 * Reads `src/data/menu.ts` directly, so it is safe in a client component.
 * The ORDERING surface must not use this: it needs the normalized
 * `@/lib/menu/types` shape (sizes, modifierGroups, the rice group) and
 * should look these ids up in the `menu` prop it already receives.
 * `favoriteItemIds` is the shared thing; this accessor is a convenience
 * for the marketing side.
 *
 * ⚠️ IT SEARCHES THE WHOLE MENU NOW, not just Specials. It used to read
 * `menu.find(c => c.id === "specials").items` and nothing else, which was
 * invisible while every favourite happened to be a Special — and would
 * have silently dropped house-soft-noodle, which is in Noodles, the moment
 * the curation stopped being Specials-only. The dev warning below would
 * have said so, but a homepage quietly showing two dishes instead of three
 * is not a thing to leave to a console message. (The menu page never had
 * this bug: OrderMenu already looks favourites up across every category.)
 *
 * `categoryId` rides along because the cards link to their dish's section
 * on the menu page, and the card should not have to guess which one.
 *
 * An id that no longer resolves is dropped rather than rendered as a hole.
 * In development that is also shouted about, because a favourite silently
 * vanishing from the homepage is the failure mode a positional slice was
 * already capable of and this file exists to end.
 */
export function favoriteCatalogItems(): FavoriteEntry[] {
  const byId = new Map<string, FavoriteEntry>();
  for (const category of menu) {
    for (const item of category.items) {
      if (!byId.has(item.id)) byId.set(item.id, { item, categoryId: category.id });
    }
  }
  const resolved = favoriteItemIds
    .map((id) => byId.get(id))
    .filter((e): e is FavoriteEntry => e !== undefined);

  if (
    process.env.NODE_ENV !== "production" &&
    resolved.length !== favoriteItemIds.length
  ) {
    const missing = favoriteItemIds.filter((id) => !byId.has(id));
    console.warn(
      `[favorites] ${missing.length} favourite id(s) no longer exist in the menu: ${missing.join(", ")}`,
    );
  }

  return resolved;
}
