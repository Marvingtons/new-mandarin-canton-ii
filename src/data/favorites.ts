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
export const favoriteItemIds = [
  "mandarin-special",
  "oceania",
  "orange-flavored-chicken-special",
  "salted-pepper-chicken-wings-special",
  "kung-po-san-shein",
  "mongolian-beef-special",
] as const;

export type FavoriteItemId = (typeof favoriteItemIds)[number];

/**
 * The raw catalogue rows for the favourites, in listed order.
 *
 * Reads `src/data/menu.ts` directly, so it is safe in a client component.
 * The ORDERING surface must not use this: it needs the normalized
 * `@/lib/menu/types` shape (sizes, modifierGroups, the rice group) and
 * should look these ids up in the `menu` prop it already receives.
 * `favoriteItemIds` is the shared thing; this accessor is a convenience
 * for the marketing side.
 *
 * An id that no longer resolves is dropped rather than rendered as a hole.
 * In development that is also shouted about, because a favourite silently
 * vanishing from the homepage is the failure mode a positional slice was
 * already capable of and this file exists to end.
 */
export function favoriteCatalogItems() {
  const specials = menu.find((c) => c.id === "specials")?.items ?? [];
  const byId = new Map(specials.map((i) => [i.id, i]));
  const resolved = favoriteItemIds
    .map((id) => byId.get(id))
    .filter((i): i is NonNullable<typeof i> => i !== undefined);

  if (
    process.env.NODE_ENV !== "production" &&
    resolved.length !== favoriteItemIds.length
  ) {
    const missing = favoriteItemIds.filter((id) => !byId.has(id));
    console.warn(
      `[favorites] ${missing.length} favourite id(s) no longer exist in the Specials category: ${missing.join(", ")}`,
    );
  }

  return resolved;
}
