/**
 * One DISH, whatever catalogue entry it was ordered under.
 *
 * The menu lists some dishes twice: the Specials copy and the numbered copy
 * (salted-pepper-chicken-wings-special and salted-pepper-chicken-wings, both
 * 椒鹽雞翼; mongolian-beef-special and mongolian-beef, both 蒙古牛肉; and so
 * on). The kitchen cooks one dish, and a report that names dishes by 中文
 * would print the same name twice. So a dish is its 中文 name: two items with
 * the same nameZh are the same dish.
 *
 * Pure, no imports: the report renderer, the reference model and the verify
 * scripts all read it, and it works on an order line's stored names as well
 * as on a catalogue item.
 */

export interface DishNamed {
  itemId: string;
  nameZh: string | null;
}

/**
 * The canonical dish key: the 中文 name, normalized (NFC, whitespace
 * collapsed), or the item id when an item has no 中文 name. The prefixes keep
 * a 中文 name and an id from ever colliding.
 */
export function dishKey(item: DishNamed): string {
  const zh = item.nameZh?.normalize("NFC").replace(/\s+/g, " ").trim();
  return zh ? `zh:${zh}` : `id:${item.itemId}`;
}
