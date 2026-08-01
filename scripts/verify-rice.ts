/**
 * The rice choice, asserted rather than asserted-in-a-comment.
 *
 * Three claims this file exists to hold:
 *
 *  1. RICE IS FREE. An order's total is identical whichever rice is
 *     chosen. This is the claim a customer would notice being broken and
 *     the one a refactor is most likely to break, because "modifier" and
 *     "priced add-on" are the same type here.
 *  2. THE RIGHT CATEGORIES HAVE IT. Appetizers, Soup, Fried Rice and
 *     Noodles must not offer a rice side; every entrée category must.
 *  3. THE SERVER ENFORCES IT. A line submitted without a rice id must be
 *     refused, because the cart is client-side JSON and a stale one will
 *     eventually arrive.
 *
 * Run: npm run verify:rice
 */
import { catalogMenu } from "@/lib/menu/catalog";
import { itemSizes, type MenuItem } from "@/lib/menu/types";
import { resolveLinePrice } from "@/lib/cart/pricing";
import { checkModifierGroups } from "@/lib/orders/modifierRules";
import { resolveOrderLine } from "@/lib/orders/lines";
import {
  RICE_BOTH_ID,
  RICE_FRIED_ID,
  RICE_GROUP_ID,
  RICE_STEAMED_ID,
  RICE_CATEGORY_IDS,
  RICE_SPLIT_CATEGORY_IDS,
} from "@/lib/menu/rice";

const EXCLUDED = ["appetizers", "soup", "fried-rice", "noodles"];

let pass = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) pass++;
  else failures.push(`  ${name}${detail ? `\n     ${detail}` : ""}`);
};

const menu = catalogMenu();
const riceOf = (item: MenuItem) =>
  item.modifierGroups.find((g) => g.id === RICE_GROUP_ID) ?? null;

/* ------------------------------------------------ 2. coverage ---- */

const counts: Record<string, { withRice: number; total: number; opts: Set<number> }> = {};
for (const cat of menu.categories) {
  const c = { withRice: 0, total: 0, opts: new Set<number>() };
  for (const item of cat.items) {
    c.total++;
    const g = riceOf(item);
    if (g) {
      c.withRice++;
      c.opts.add(g.modifiers.length);
    }
  }
  counts[cat.id] = c;
}

for (const id of EXCLUDED) {
  const c = counts[id];
  if (!c) continue;
  check(
    `${id}: no rice selector`,
    c.withRice === 0,
    `${c.withRice}/${c.total} items offered rice`,
  );
}

for (const id of RICE_CATEGORY_IDS) {
  const c = counts[id];
  if (!c) {
    check(`${id}: category exists`, false, "category not found in the menu");
    continue;
  }
  check(
    `${id}: every item offers rice`,
    c.withRice === c.total && c.total > 0,
    `${c.withRice}/${c.total}`,
  );
  check(
    `${id}: two options (no half-and-half on a single entrée)`,
    c.opts.size === 1 && c.opts.has(2),
    `option counts seen: ${[...c.opts].join(",")}`,
  );
}

for (const id of RICE_SPLIT_CATEGORY_IDS) {
  const c = counts[id];
  if (!c) {
    check(`${id}: category exists`, false, "category not found in the menu");
    continue;
  }
  check(
    `${id}: every item offers rice`,
    c.withRice === c.total && c.total > 0,
    `${c.withRice}/${c.total}`,
  );
  check(
    `${id}: three options including half-and-half`,
    c.opts.size === 1 && c.opts.has(3),
    `option counts seen: ${[...c.opts].join(",")}`,
  );
}

// Lunch specials get the two-option group alongside their entrée choice.
{
  const lunch = menu.categories.find((c) => c.id === "lunch-specials");
  check("lunch-specials: category exists", !!lunch);
  if (lunch) {
    check(
      "lunch-specials: every tier offers rice",
      lunch.items.every((i) => riceOf(i) !== null),
      "",
    );
    check(
      "lunch-specials: keeps its entrée choice group as well",
      lunch.items.every((i) => i.modifierGroups.length >= 2),
      "",
    );
    check(
      "lunch-specials: rice is two options",
      lunch.items.every((i) => riceOf(i)?.modifiers.length === 2),
      "",
    );
    check(
      "lunch-specials: rice no longer duplicated in the sides sentence",
      lunch.items.every((i) => !/\brice\b/i.test(i.description ?? "")),
      lunch.items.map((i) => i.description).join(" | "),
    );
  }
}

/* --------------------------------- 1. price invariance (the big one) ---- */

let priced = 0;
let maxDelta = 0;
for (const cat of menu.categories) {
  for (const item of cat.items) {
    const g = riceOf(item);
    if (!g) continue;
    for (const size of itemSizes(item)) {
      // Every other required group must still be satisfied, or the line is
      // not comparable. Take the first option of each.
      const others = item.modifierGroups
        .filter((x) => x.id !== RICE_GROUP_ID && x.minRequired > 0)
        .map((x) => x.modifiers[0]?.id)
        .filter((x): x is string => !!x);

      const totals = g.modifiers.map(
        (m) => resolveLinePrice(item, size.id, [...others, m.id], 3).lineCents,
      );
      priced++;
      const delta = Math.max(...totals) - Math.min(...totals);
      if (delta > maxDelta) maxDelta = delta;
      if (delta !== 0) {
        failures.push(
          `  price changed with rice choice: ${item.id} / ${size.id}\n     ${g.modifiers
            .map((m, i) => `${m.id}=${totals[i]}`)
            .join(" ")}`,
        );
      } else {
        pass++;
      }
    }
  }
}

check(
  `every rice option is $0 across ${priced} item/size combinations`,
  maxDelta === 0,
  `largest total difference was ${maxDelta} cents`,
);

/* ------------------------------------------ 3. server enforcement ---- */

{
  const withRice = menu.categories
    .flatMap((c) => c.items)
    .find((i) => riceOf(i) !== null);

  if (!withRice) {
    check("found an item with rice to test enforcement", false);
  } else {
    const others = withRice.modifierGroups
      .filter((x) => x.id !== RICE_GROUP_ID && x.minRequired > 0)
      .map((x) => x.modifiers[0]!.id);

    check(
      "a line with no rice id is refused",
      checkModifierGroups(withRice, others) !== null,
      "the server accepted a line missing its required rice",
    );
    check(
      "a line with steamed rice is accepted",
      checkModifierGroups(withRice, [...others, RICE_STEAMED_ID]) === null,
      "",
    );
    check(
      "two rices at once are refused",
      checkModifierGroups(withRice, [
        ...others,
        RICE_STEAMED_ID,
        RICE_FRIED_ID,
      ]) !== null,
      "maxAllowed 1 was not enforced",
    );
    check(
      "a duplicate id is refused",
      checkModifierGroups(withRice, [
        ...others,
        RICE_STEAMED_ID,
        RICE_STEAMED_ID,
      ]) !== null,
      "",
    );
    check(
      "half-and-half is refused on a single entrée",
      checkModifierGroups(withRice, [...others, RICE_BOTH_ID]) !== null ||
        !RICE_CATEGORY_IDS.has(withRice.categoryId),
      "a one-person dish accepted the split-rice option",
    );
  }
}

/* ------------------------------- what actually reaches the ticket ---- */

{
  const family = menu.categories
    .find((c) => c.id === "family-dinners")
    ?.items[0];
  if (family) {
    const line = resolveOrderLine(
      family,
      itemSizes(family)[0].id,
      [RICE_BOTH_ID],
      1,
    );
    const rice = line.modifiers.find((m) => m.id === RICE_BOTH_ID);
    check(
      "half-and-half prints as 白飯+炒飯",
      rice?.nameZh === "白飯+炒飯",
      `printed nameZh was ${JSON.stringify(rice?.nameZh)}`,
    );
    check("half-and-half costs nothing", rice?.priceCents === 0, "");
  } else {
    check("found a family dinner to test the printed name", false);
  }
}

const total = pass + failures.length;
console.log(`rice: ${pass}/${total} checks passed (${priced} priced combinations)`);
if (failures.length > 0) {
  console.error("\nFAILED:");
  for (const f of failures) console.error(f);
  process.exit(1);
}
