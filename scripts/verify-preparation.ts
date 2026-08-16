/**
 * The Fried/Steamed Rice preparation (#116), asserted rather than trusted.
 *
 * The preparation is the dish's OWN making — steamed vs fried — and NOT the
 * entrée included-rice side. This suite holds the five claims that separation
 * turns on:
 *
 *  1. IT IS A REQUIRED, $0, TWO-WAY CHOICE. #116 carries a `prep` group with
 *     Steamed and Fried, both free today, at BOTH sizes (individual + tray).
 *     Per-option pricing is WIRED (the option carries priceCents and
 *     resolveLinePrice sums it), so this asserts the $0 invariance holds now
 *     rather than leaving it to a comment — the one thing a "fried costs more"
 *     edit would flip.
 *  2. IT IS NOT THE RICE SIDE. #116 must offer no `rice` group at any size, and
 *     a rice id is not a preparation id. (verify:rice guards the same fact from
 *     the rice side.)
 *  3. THE SERVER DEFAULTS A MISSING CHOICE, IT DOES NOT REFUSE IT. A stale cart
 *     line with no preparation is defaulted to Steamed and accepted — unlike a
 *     missing rice side, which is refused. The group is still genuinely
 *     required: without the default injection the group check fails.
 *  4. THE CHOICE PRINTS ON THE ITEM LINE. Rendered, the steamed side is the
 *     item's own name line ("Steamed Rice" / 白飯), never a ● bullet.
 *  5. THE TWO RICES STAY DISTINCT. On one ticket, a steamed rice SIDE and an
 *     entrée's FRIED rice print unmistakably differently: the side on the item
 *     line, the entrée's rice as a ● side beneath it.
 *
 * Run: npm run verify:preparation
 */
import { catalogMenu } from "@/lib/menu/catalog";
import { itemSizes, type MenuItem } from "@/lib/menu/types";
import { resolveLinePrice } from "@/lib/cart/pricing";
import { checkModifierGroups } from "@/lib/orders/modifierRules";
import { resolveOrderLine } from "@/lib/orders/lines";
import { groupsForSize } from "@/lib/menu/rice";
import { composeTicketSvg } from "@/lib/ticket/render";
import {
  PREP_GROUP_ID,
  PREP_STEAMED_ID,
  PREP_FRIED_ID,
  isPreparationModifierId,
  applyPreparationDefault,
} from "@/lib/menu/preparation";
import { RICE_GROUP_ID, RICE_STEAMED_ID } from "@/lib/menu/rice";
import { preparationOrder } from "./fixtures/orders";

const TIMEZONE = "America/Los_Angeles";

let pass = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) pass++;
  else failures.push(`  ${name}${detail ? `\n     ${detail}` : ""}`);
};

const menu = catalogMenu();
const byId = new Map(
  menu.categories.flatMap((c) => c.items).map((i) => [i.id, i]),
);
const item = byId.get("fried-steamed-rice");
const prepOf = (it: MenuItem) =>
  it.modifierGroups.find((g) => g.id === PREP_GROUP_ID) ?? null;
const riceOf = (it: MenuItem) =>
  it.modifierGroups.find((g) => g.id === RICE_GROUP_ID) ?? null;

/* ------------------------------------------ 1. the group's shape ---- */

check("Fried/Steamed Rice (#116) resolves from the catalogue", !!item);

if (!item) {
  console.error("preparation: #116 not found — cannot run the suite");
  process.exit(1);
}

const prep = prepOf(item);
check("#116 carries a preparation group", !!prep, "no `prep` group on the item");
if (prep) {
  check(
    "the group is a required single choice",
    prep.minRequired === 1 && prep.maxAllowed === 1,
    `minRequired=${prep.minRequired} maxAllowed=${prep.maxAllowed}`,
  );
  check(
    "the group offers exactly Steamed then Fried",
    prep.modifiers.map((m) => m.id).join(",") ===
      `${PREP_STEAMED_ID},${PREP_FRIED_ID}`,
    `ids: ${prep.modifiers.map((m) => m.id).join(",")}`,
  );
  check(
    "Steamed is listed first (the sheet's default)",
    prep.modifiers[0]?.id === PREP_STEAMED_ID,
    `first option is ${prep.modifiers[0]?.id}`,
  );
  check(
    "both options are $0 today (per-option pricing is wired, not used)",
    prep.modifiers.every((m) => m.priceCents === 0),
    prep.modifiers.map((m) => `${m.id}=${m.priceCents}`).join(" "),
  );
  check(
    "the printed option names are the two rices, bilingual",
    prep.modifiers.find((m) => m.id === PREP_STEAMED_ID)?.nameEn ===
      "Steamed Rice" &&
      prep.modifiers.find((m) => m.id === PREP_STEAMED_ID)?.nameZh === "白飯" &&
      prep.modifiers.find((m) => m.id === PREP_FRIED_ID)?.nameEn ===
        "Fried Rice" &&
      prep.modifiers.find((m) => m.id === PREP_FRIED_ID)?.nameZh === "炒飯",
    "option names/中文 are not the expected 白飯 Steamed / 炒飯 Fried",
  );
}

check(
  "isPreparationModifierId knows the prep ids and not the rice ids",
  isPreparationModifierId(PREP_STEAMED_ID) &&
    isPreparationModifierId(PREP_FRIED_ID) &&
    !isPreparationModifierId(RICE_STEAMED_ID),
  "the id predicate does not partition prep from rice",
);

/* ---------------------------------- 2. it is NOT the rice side ---- */

check(
  "#116 offers NO rice group at any size (it IS rice)",
  itemSizes(item).every(
    (s) => !groupsForSize(item, s.id).some((g) => g.id === RICE_GROUP_ID),
  ),
  "the entrée rice side reached a dish that already is rice",
);
check("#116 has no rice group at all", riceOf(item) === null);

/* ------------------------- 1b. prep at BOTH sizes, $0 both ways ---- */

for (const size of itemSizes(item)) {
  // The prep group is never size-filtered (only rice is), so it must survive on
  // the tray as well as the individual portion.
  check(
    `the preparation group is offered at the "${size.id}" size`,
    groupsForSize(item, size.id).some((g) => g.id === PREP_GROUP_ID),
    "the preparation disappeared on a size it should apply to",
  );
  const steamed = resolveLinePrice(item, size.id, [PREP_STEAMED_ID], 1).lineCents;
  const fried = resolveLinePrice(item, size.id, [PREP_FRIED_ID], 1).lineCents;
  check(
    `steamed and fried cost the same at "${size.id}" (both $0 delta today)`,
    steamed === fried && steamed === size.priceCents,
    `steamed=${steamed} fried=${fried} size=${size.priceCents}`,
  );
}

/* ------------------ 3. server DEFAULTS a missing choice ---- */

for (const size of itemSizes(item)) {
  // Genuinely required: without the default, the group check refuses it.
  check(
    `a "${size.id}" line with no preparation is refused before defaulting`,
    checkModifierGroups(item, size.id, []) !== null,
    "the required preparation was not enforced",
  );
  // The stale-cart path: default to Steamed, warn (logged by the route), accept.
  const defaulted = applyPreparationDefault(item, []);
  check(
    `a "${size.id}" stale line defaults to Steamed rather than being refused`,
    defaulted.defaulted &&
      defaulted.modifierIds.includes(PREP_STEAMED_ID) &&
      checkModifierGroups(item, size.id, defaulted.modifierIds) === null,
    `defaulted=${defaulted.defaulted} ids=${defaulted.modifierIds.join(",")}`,
  );
}

check(
  "a line that already chose a preparation is left untouched",
  applyPreparationDefault(item, [PREP_FRIED_ID]).defaulted === false,
  "the default injected over an existing choice",
);

{
  // An item WITHOUT a preparation group is returned unchanged, so the route can
  // call applyPreparationDefault on every line unconditionally.
  const entree = byId.get("mongolian-beef-special");
  check(
    "an item with no preparation group is passed through unchanged",
    !!entree &&
      applyPreparationDefault(entree, [RICE_STEAMED_ID]).defaulted === false &&
      applyPreparationDefault(entree, [RICE_STEAMED_ID]).modifierIds.join(",") ===
        RICE_STEAMED_ID,
    "a non-prep item was altered by the default",
  );
}

/* --------------------------- what reaches the stored line ---- */

{
  const line = resolveOrderLine(item, "individual", [PREP_STEAMED_ID], 1);
  const mod = line.modifiers.find((m) => m.id === PREP_STEAMED_ID);
  check(
    "the stored line carries the steamed preparation, bilingual",
    mod?.nameEn === "Steamed Rice" && mod?.nameZh === "白飯",
    `stored: ${JSON.stringify(mod)}`,
  );
  check("the steamed side is $3.00", line.lineCents === 300, `lineCents=${line.lineCents}`);
  check(
    "the stored line carries no rice-side modifier",
    !line.modifiers.some((m) => m.id === RICE_STEAMED_ID),
    "a rice-side id leaked onto the rice dish",
  );
}

/* ------------- 4 & 5. it prints on the item line, distinct from the side ---- */

async function renderChecks(): Promise<void> {
  const { lines } = await composeTicketSvg(await preparationOrder(), {
    timezone: TIMEZONE,
  });
  const texts = lines.map((l) => l.text);
  const has = (t: string) => texts.includes(t);
  const anyBulletWith = (needle: string) =>
    texts.some((t) => t.startsWith("●") && t.includes(needle));

  // 4: the steamed side is the item's OWN name line, not a ● bullet.
  check(
    "the steamed side prints on the item line",
    has("Steamed Rice") && has("白飯"),
    `item-line texts seen: ${texts.filter((t) => /Rice|飯/.test(t)).join(" | ")}`,
  );
  check(
    "the steamed side is NOT printed as a ● side bullet",
    !anyBulletWith("Steamed Rice") && !anyBulletWith("白飯"),
    "the preparation printed as a side, the thing it must never be",
  );
  check(
    "the either/or placeholder 炒飯／白飯 does not print (it was resolved)",
    !has("炒飯／白飯"),
    "the unresolved menu name printed instead of the chosen rice",
  );

  // 5: the entrée's included rice is a ● side beneath it — the other shape.
  check(
    "the entrée's fried rice prints as a ● side beneath it",
    has("● 炒飯 / Fried Rice"),
    `bullet texts seen: ${texts.filter((t) => t.startsWith("●")).join(" | ")}`,
  );
}

async function main(): Promise<void> {
  await renderChecks();

  const total = pass + failures.length;
  console.log(`preparation: ${pass}/${total} checks passed`);
  if (failures.length > 0) {
    console.error("\nFAILED:");
    for (const f of failures) console.error(f);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
