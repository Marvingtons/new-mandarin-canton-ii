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
 *  4. A PARTY TRAY DOES NOT INCLUDE RICE. Rice comes with an individual
 *     portion. The tray must offer no selector, must not be refused for
 *     the rice it correctly lacks, must have injected rice stripped
 *     rather than rejected, and must print a ticket with no rice line.
 *     The size audit behind that rule is asserted here too, so a new
 *     rice-bearing size cannot appear without this file noticing.
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
  SIZE_IDS_WITHOUT_RICE,
  groupsForSize,
  stripRiceForSize,
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
    // The rice-bearing tier. Every check below is about the size that
    // DOES include rice; the tray gets its own section further down.
    const indiv = itemSizes(withRice)[0]!.id;

    check(
      "a line with no rice id is refused",
      checkModifierGroups(withRice, indiv, others) !== null,
      "the server accepted a line missing its required rice",
    );
    check(
      "a line with steamed rice is accepted",
      checkModifierGroups(withRice, indiv, [...others, RICE_STEAMED_ID]) ===
        null,
      "",
    );
    check(
      "two rices at once are refused",
      checkModifierGroups(withRice, indiv, [
        ...others,
        RICE_STEAMED_ID,
        RICE_FRIED_ID,
      ]) !== null,
      "maxAllowed 1 was not enforced",
    );
    check(
      "a duplicate id is refused",
      checkModifierGroups(withRice, indiv, [
        ...others,
        RICE_STEAMED_ID,
        RICE_STEAMED_ID,
      ]) !== null,
      "",
    );
    check(
      "half-and-half is refused on a single entrée",
      checkModifierGroups(withRice, indiv, [...others, RICE_BOTH_ID]) !==
        null || !RICE_CATEGORY_IDS.has(withRice.categoryId),
      "a one-person dish accepted the split-rice option",
    );
  }
}

/* ------------------------------------ 4. trays do not include rice ---- */

{
  // The audit behind SIZE_IDS_WITHOUT_RICE: every size id the built menu
  // produces, and whether any of its tiers is rice-bearing. A new size
  // that carries rice and should not will show up here as a name this
  // list has never seen.
  const sizeIds = new Map<string, boolean>();
  for (const cat of menu.categories) {
    for (const item of cat.items) {
      const hasRice = riceOf(item) !== null;
      for (const s of itemSizes(item)) {
        sizeIds.set(s.id, (sizeIds.get(s.id) ?? false) || hasRice);
      }
    }
  }
  const riceBearing = [...sizeIds].filter(([, v]) => v).map(([k]) => k).sort();
  check(
    "the rice-bearing size ids are the expected seven",
    riceBearing.join(",") ===
      "individual,party-tray,people-2,people-3,people-4,people-5,people-6,regular"
        .split(",")
        .sort()
        .join(","),
    `saw: ${riceBearing.join(",")}`,
  );
  check(
    "party-tray is the only size excluded from rice",
    [...SIZE_IDS_WITHOUT_RICE].join(",") === "party-tray",
    `SIZE_IDS_WITHOUT_RICE = ${[...SIZE_IDS_WITHOUT_RICE].join(",")}`,
  );

  // Roasted Duck (half/whole) and Egg Drop Soup (cup/bowl) were named as
  // candidates for exclusion. They need no rule: appetizers and soup are
  // not rice categories, so those items have no rice group at any size.
  for (const [label, sizeA] of [
    ["Roasted Duck", "half"],
    ["Egg Drop Soup", "cup"],
  ] as const) {
    const item = menu.categories
      .flatMap((c) => c.items)
      .find((i) => itemSizes(i).some((s) => s.id === sizeA));
    check(
      `${label} (${sizeA}) has no rice group to switch off`,
      !!item && riceOf(item) === null,
      item ? `found a rice group on ${item.id}` : `no item with size ${sizeA}`,
    );
  }

  const tray = menu.categories
    .flatMap((c) => c.items)
    .find(
      (i) =>
        riceOf(i) !== null && itemSizes(i).some((s) => s.id === "party-tray"),
    );

  if (!tray) {
    check("found a rice-bearing item with a party tray", false);
  } else {
    const others = tray.modifierGroups
      .filter((x) => x.id !== RICE_GROUP_ID && x.minRequired > 0)
      .map((x) => x.modifiers[0]!.id);

    check(
      "the tray size offers no rice group",
      !groupsForSize(tray, "party-tray").some((g) => g.id === RICE_GROUP_ID),
      `${tray.id} still offered rice on a tray`,
    );
    check(
      "the individual size still offers one",
      groupsForSize(tray, "individual").some((g) => g.id === RICE_GROUP_ID),
      `${tray.id} lost its rice group on the individual tier`,
    );
    check(
      "a tray line with NO rice is accepted",
      checkModifierGroups(tray, "party-tray", others) === null,
      "the required-rice check fired on a size that has no rice",
    );
    check(
      "the same line on an individual portion is still refused",
      checkModifierGroups(tray, "individual", others) !== null,
      "rice stopped being required where it is included",
    );

    // The stale-cart path: a tray line arriving WITH rice is stripped,
    // not refused.
    const injected = [...others, RICE_STEAMED_ID];
    const stripped = stripRiceForSize("party-tray", injected);
    check(
      "injected rice on a tray is stripped",
      stripped.removed.join(",") === RICE_STEAMED_ID &&
        !stripped.modifierIds.includes(RICE_STEAMED_ID),
      `removed=${stripped.removed.join(",")} kept=${stripped.modifierIds.join(",")}`,
    );
    check(
      "the strip leaves every other modifier alone",
      others.every((id) => stripped.modifierIds.includes(id)),
      `kept=${stripped.modifierIds.join(",")}`,
    );
    check(
      "the same ids on an individual portion are untouched",
      stripRiceForSize("individual", injected).removed.length === 0,
      "rice was stripped from a portion that includes it",
    );
    check(
      "the stripped line then passes the group check",
      checkModifierGroups(tray, "party-tray", stripped.modifierIds) === null,
      "",
    );

    // What the kitchen would print. This is the fixture the rule exists
    // for: a tray ticket with a rice line is the failure mode.
    const line = resolveOrderLine(
      tray,
      "party-tray",
      stripped.modifierIds,
      1,
    );
    check(
      "a tray ticket carries no rice line",
      !line.modifiers.some((m) =>
        [RICE_STEAMED_ID, RICE_FRIED_ID, RICE_BOTH_ID].includes(m.id),
      ),
      `printed: ${line.modifiers.map((m) => m.nameEn).join(", ") || "(none)"}`,
    );
    check(
      "stripping the rice does not change the tray price",
      line.lineCents ===
        resolveLinePrice(tray, "party-tray", injected, 1).lineCents,
      "the $0 claim broke on the tray tier",
    );
  }

  // Family Dinners and Big Family are combos, not trays: their three-way
  // selector is untouched at every size they offer.
  for (const id of RICE_SPLIT_CATEGORY_IDS) {
    const cat = menu.categories.find((c) => c.id === id);
    if (!cat) continue;
    check(
      `${id}: keeps its three-way rice at every size`,
      cat.items.every((item) =>
        itemSizes(item).every(
          (s) =>
            groupsForSize(item, s.id).find((g) => g.id === RICE_GROUP_ID)
              ?.modifiers.length === 3,
        ),
      ),
      "a combo size lost the 各一半 option",
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
