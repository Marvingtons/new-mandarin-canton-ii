/**
 * 常點 POPULAR: the first tab on the POS. THE OWNER EDITS THIS LIST.
 *
 * Add, remove or reorder menu item ids; the tab shows them in this order. An
 * id that is not on the menu is skipped, so a typo hides a dish rather than
 * breaking the screen. Keep it to about 18 (six rows of three on an iPad).
 *
 * Where the first list came from (2026-11-17): every non-cancelled order in
 * the orders database, web and POS together (43 orders, 127 items, 36
 * dishes), ranked by quantity sold. A dish the menu lists twice (in 招牌
 * Specials and in its own category) is counted once, under the Specials id.
 * These 18 are 85% of everything ordered. 43 orders is a small sample, so
 * re-rank once the store has a few weeks of POS orders.
 */
export const POS_POPULAR_IDS: readonly string[] = [
  "salted-pepper-chicken-wings-special", // 21 椒鹽雞翼
  "egg-rolls", // 19 春卷
  "orange-flavored-chicken-special", // 8 陳皮雞
  "mongolian-beef-special", // 7 蒙古牛肉
  "beef-broccoli", // 6 西蘭花牛肉
  "house-soft-noodle", // 6 招牌炒麵
  "combo-lunch-16-25", // 5 午市套餐 B
  "salt-pepper-chicken-wings-app", // 5 椒鹽雞翼（6隻）
  "fried-cream-cheese-wonton", // 4 炸忌廉芝士雲吞
  "mandarin-special", // 4 招牌大拼盤
  "salted-pepper-tofu", // 4 椒鹽豆腐
  "sweet-sour-chicken", // 4 咕嚕雞
  "beef-soft-noodle", // 3 牛肉炒麵
  "honey-walnut-shrimp", // 3 蜜汁核桃蝦
  "house-special-fried-rice", // 3 招牌炒飯
  "bbq-pork-fried-rice", // 2 叉燒炒飯
  "chicken-chop-suey", // 2 雜碎雞
  "chicken-soft-noodle", // 2 雞肉炒麵
];
