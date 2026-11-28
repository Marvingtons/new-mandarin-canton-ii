/**
 * The /menu JSON-LD lists exactly what the menu grid shows.
 *
 *   npm run verify:menu-schema
 *
 * Renders menuGraph() through graph() as the page does and asserts that a
 * soft-removed dish (Roasted Duck) is absent, prices and all; that an
 * available dish is present with its offers; and that every marked-up item is
 * one the grid shows (websiteMenu() and isAvailable, the grid's own filter).
 * Alcohol is POS-only, so no staff-only item is ever marked up.
 */
import { graph, menuGraph } from "../src/lib/schema";
import { catalogMenu, websiteMenu } from "../src/lib/menu/catalog";
import { isAvailable } from "../src/lib/menu/types";
import { menu } from "../src/data/menu";

type Node = Record<string, unknown>;

let passes = 0;
let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${!ok && detail ? `\n    ${detail}` : ""}`);
}

const rendered = JSON.stringify(graph(menuGraph()));
const doc = JSON.parse(rendered) as { "@graph": Node[] };
const menuNode = doc["@graph"].find((n) => n["@type"] === "Menu") as Node;
const items = ((menuNode.hasMenuSection as Node[]) ?? []).flatMap((s) => (s.hasMenuItem as Node[]) ?? []);
const names = items.map((i) => String(i.name));

check("the rendered schema has a Menu with items", items.length > 0, `${items.length} items`);
check("Roasted Duck is absent from the menu schema", !names.includes("Roasted Duck"));
check("no Roasted Duck string anywhere in the rendered JSON-LD", !rendered.includes("Roasted Duck"));

const kungPao = items.find((i) => i.name === "Kung Pao Chicken");
const offers = (kungPao?.offers as Node[] | undefined) ?? [];
check(
  "an available dish (Kung Pao Chicken) is present with its prices",
  !!kungPao && offers.length > 0 && offers.every((o) => typeof o.price === "string"),
  JSON.stringify(kungPao),
);

const shownIds = new Set(websiteMenu().categories.flatMap((c) => c.items).filter(isAvailable).map((i) => i.id));
const shownNames = new Set(menu.flatMap((c) => c.items).filter((i) => shownIds.has(i.id)).map((i) => i.name));
const extra = names.filter((n) => !shownNames.has(n));
const missing = [...shownNames].filter((n) => !names.includes(n));
check("every marked-up item is one the grid shows", extra.length === 0, extra.join(", "));
check("every à la carte item the grid shows is marked up", missing.length === 0, missing.join(", "));

const staffOnlyNames = catalogMenu().categories.flatMap((c) => c.items).filter((i) => i.staffOnly).map((i) => i.nameEn);
check("there are staff-only items (beer, wine) to keep off the schema", staffOnlyNames.length === 3, staffOnlyNames.join(", "));
check("no staff-only item (alcohol) is marked up", staffOnlyNames.every((n) => !names.includes(n)), staffOnlyNames.filter((n) => names.includes(n)).join(", "));
check("tea and soft drink are marked up", names.includes("Hot Tea or Iced Tea") && names.includes("Soft Drink"));
check("Wonton Chips is marked up", names.includes("Wonton Chips"));

console.log(`\nmenu schema: ${passes}/${passes + failures} checks passed`);
process.exit(failures === 0 ? 0 : 1);
