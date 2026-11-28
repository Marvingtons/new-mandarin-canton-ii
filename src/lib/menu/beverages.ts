import { menu } from "@/data/menu";

/**
 * 飲品 BEVERAGES on the kitchen ticket.
 *
 * The ticket prints its lines in the order they were rung, with no category
 * grouping. Drinks are the one exception: a tea or a beer between two wok
 * dishes is a line the cook has to read past, so drink lines move to their
 * own block at the bottom of the items, under a 飲品 DRINKS heading, in the
 * order they were rung. Everything else keeps its order.
 *
 * Identity is by item id against the catalogue's "beverages" section: an
 * OrderLine stores no category. Pure data, no server-only, so the renderer,
 * the verify scripts and the samples all read the same set.
 */
export const BEVERAGES_CATEGORY_ID = "beverages";

const BEVERAGE_ITEM_IDS: ReadonlySet<string> = new Set(
  menu.find((c) => c.id === BEVERAGES_CATEGORY_ID)?.items.map((i) => i.id) ?? [],
);

export function isBeverageItemId(itemId: string): boolean {
  return BEVERAGE_ITEM_IDS.has(itemId);
}

/** Split lines into the wok's (in order) and the drinks (in order). */
export function splitBeverages<T extends { itemId: string }>(lines: readonly T[]): { food: T[]; drinks: T[] } {
  const food: T[] = [];
  const drinks: T[] = [];
  for (const line of lines) (isBeverageItemId(line.itemId) ? drinks : food).push(line);
  return { food, drinks };
}
