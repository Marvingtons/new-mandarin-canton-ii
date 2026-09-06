/**
 * The name-hidden protein/preparation choice, asserted rather than trusted.
 *
 * "Chicken or Beef Chow Fun (Dry)" (#124), the Specials "Black Pepper Beef or
 * Chicken", and "Steamed or Fried Dumplings (8)" (#6) each hide a required
 * choice in their name. This suite holds the claims that turns on:
 *
 *  1. EACH IS A REQUIRED, TWO-WAY, NO-DEFAULT CHOICE. A `choice` group with two
 *     bilingual options, minRequired 1 / maxAllowed 1, `requireExplicitChoice`
 *     set (the sheet preselects nothing), at EVERY size the dish offers.
 *  2. PRICE IS INVARIANT ACROSS OPTIONS. Chicken and Beef cost the same at every
 *     size; per-option pricing is wired but $0 today. This is the claim a "Beef
 *     costs more" edit would flip, so it is asserted, not commented.
 *  3. THE SERVER REFUSES A MISSING CHOICE — it does NOT default one. Unlike the
 *     #116 preparation (defaulted to Steamed), a missing protein is refused,
 *     because there is no defensible default and the kitchen must not be handed
 *     a silently-picked protein. A stale cart is refused with the humane group
 *     message, and the storage key bump drops it at the door client-side.
 *  4. THE CHOSEN OPTION LEADS THE ITEM LINE, "or" GONE. Rendered, the line reads
 *     "Beef · Chow Fun (Dry)" / "牛 · 乾炒河粉"; the unresolved "…or…" name never
 *     prints, and the chosen protein is NOT a ● side.
 *  5. IT STAYS DISTINCT FROM THE RICE SIDE. On the Black Pepper line the protein
 *     is on the item line and the rice is a ● side beneath it — two shapes, one
 *     ticket.
 *  6. THE LUNCH "OR" IS SPLIT, NOT NESTED. The lunch tier lists "Chicken Chow
 *     Fun (Dry)" and "Beef Chow Fun (Dry)" as two entrées, both bilingual, and
 *     no longer the single "Chicken or Beef …".
 *  7. THE STAGED es LABELS COVER EVERY OPTION.
 *
 * Run: npm run verify:choice
 */
import { catalogMenu } from "@/lib/menu/catalog";
import { itemSizes, type MenuItem } from "@/lib/menu/types";
import { resolveLinePrice } from "@/lib/cart/pricing";
import { checkModifierGroups } from "@/lib/orders/modifierRules";
import { resolveOrderLine } from "@/lib/orders/lines";
import {
  CHOICE_GROUP_ID,
  isChoiceModifierId,
  resolveChoiceLine,
} from "@/lib/menu/choice";
import { RICE_GROUP_ID, RICE_STEAMED_ID } from "@/lib/menu/rice";
import { composeTicketSvg } from "@/lib/ticket/render";
import { choiceOptionEsIds } from "@/data/menu-choice-es";
import { choiceOrder } from "./fixtures/orders";

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
const choiceOf = (it: MenuItem) =>
  it.modifierGroups.find((g) => g.id === CHOICE_GROUP_ID) ?? null;
const riceOf = (it: MenuItem) =>
  it.modifierGroups.find((g) => g.id === RICE_GROUP_ID) ?? null;

/** The three dishes, with what each option must resolve to on the line. */
const CASES = [
  {
    id: "chow-fun-chicken-or-beef",
    label: "#124 Chicken or Beef Chow Fun (Dry)",
    hasRice: false,
    options: [
      { id: "chow-fun-chicken", nameEn: "Chicken", nameZh: "雞", lineEn: "Chicken · Chow Fun (Dry)", lineZh: "雞 · 乾炒河粉" },
      { id: "chow-fun-beef", nameEn: "Beef", nameZh: "牛", lineEn: "Beef · Chow Fun (Dry)", lineZh: "牛 · 乾炒河粉" },
    ],
  },
  {
    id: "black-pepper-beef-or-chicken",
    label: "Specials Black Pepper Beef or Chicken",
    hasRice: true,
    options: [
      { id: "black-pepper-beef", nameEn: "Beef", nameZh: "牛", lineEn: "Beef · Black Pepper", lineZh: "牛 · 黑椒" },
      { id: "black-pepper-chicken", nameEn: "Chicken", nameZh: "雞", lineEn: "Chicken · Black Pepper", lineZh: "雞 · 黑椒" },
    ],
  },
  {
    id: "steamed-or-fried-dumplings",
    label: "#6 Steamed or Fried Dumplings (8)",
    hasRice: false,
    options: [
      { id: "dumplings-steamed", nameEn: "Steamed", nameZh: "蒸", lineEn: "Steamed · Dumplings (8)", lineZh: "蒸 · 餃（8隻）" },
      { id: "dumplings-fried", nameEn: "Fried", nameZh: "煎", lineEn: "Fried · Dumplings (8)", lineZh: "煎 · 餃（8隻）" },
    ],
  },
] as const;

/* --------------------------------------- 1. shape, per dish ---- */

for (const c of CASES) {
  const item = byId.get(c.id);
  check(`${c.label}: resolves from the catalogue`, !!item);
  if (!item) continue;

  const group = choiceOf(item);
  check(`${c.label}: carries a choice group`, !!group);
  if (!group) continue;

  check(
    `${c.label}: required single choice`,
    group.minRequired === 1 && group.maxAllowed === 1,
    `minRequired=${group.minRequired} maxAllowed=${group.maxAllowed}`,
  );
  check(
    `${c.label}: no default is preselected (requireExplicitChoice)`,
    group.requireExplicitChoice === true,
    "the sheet would auto-pick the first protein",
  );
  check(
    `${c.label}: offers exactly the expected two bilingual options`,
    group.modifiers.length === c.options.length &&
      group.modifiers.every(
        (m, i) =>
          m.id === c.options[i].id &&
          m.nameEn === c.options[i].nameEn &&
          m.nameZh === c.options[i].nameZh,
      ),
    `ids: ${group.modifiers.map((m) => `${m.id}=${m.nameEn}/${m.nameZh}`).join(" ")}`,
  );
  check(
    `${c.label}: the item carries ticket-base meta`,
    !!item.choice && item.choice.ticketBaseEn.length > 0,
    "no ticket base name to combine with the chosen option",
  );
  check(
    `${c.label}: rice ${c.hasRice ? "IS" : "is NOT"} offered alongside`,
    (riceOf(item) !== null) === c.hasRice,
    `rice group ${riceOf(item) ? "present" : "absent"}`,
  );
  check(
    `${c.label}: isChoiceModifierId knows its options and not a rice id`,
    c.options.every((o) => isChoiceModifierId(item, o.id)) &&
      !isChoiceModifierId(item, RICE_STEAMED_ID),
    "the option predicate does not partition the choice from rice",
  );

  /* --- 1b. offered at EVERY size, and $0 across options at each --- */
  for (const size of itemSizes(item)) {
    check(
      `${c.label}: choice offered at "${size.id}"`,
      item.modifierGroups.some((g) => g.id === CHOICE_GROUP_ID),
      "the choice disappeared on a size it should apply to",
    );
    // Other required groups (rice) must be satisfied to compare prices.
    const others = item.modifierGroups
      .filter((g) => g.id !== CHOICE_GROUP_ID && g.minRequired > 0)
      .map((g) => g.modifiers[0]!.id);
    const totals = c.options.map(
      (o) => resolveLinePrice(item, size.id, [...others, o.id], 3).lineCents,
    );
    check(
      `${c.label}: every option costs the same at "${size.id}"`,
      Math.max(...totals) - Math.min(...totals) === 0,
      c.options.map((o, i) => `${o.id}=${totals[i]}`).join(" "),
    );
  }

  /* --- 3. server REFUSES a missing choice, ACCEPTS a chosen one --- */
  {
    const size = itemSizes(item)[0]!.id;
    const others = item.modifierGroups
      .filter((g) => g.id !== CHOICE_GROUP_ID && g.minRequired > 0)
      .map((g) => g.modifiers[0]!.id);
    check(
      `${c.label}: a line with no choice is REFUSED (not defaulted)`,
      checkModifierGroups(item, size, others) !== null,
      "the required choice was not enforced",
    );
    check(
      `${c.label}: a line with a chosen option is accepted`,
      checkModifierGroups(item, size, [...others, c.options[0].id]) === null,
      "a valid choice line was refused",
    );
    check(
      `${c.label}: two options at once are refused`,
      checkModifierGroups(item, size, [
        ...others,
        c.options[0].id,
        c.options[1].id,
      ]) !== null,
      "maxAllowed 1 was not enforced",
    );
  }

  /* --- 4. what reaches the stored line: name baked, option dropped --- */
  for (const o of c.options) {
    const others = item.modifierGroups
      .filter((g) => g.id !== CHOICE_GROUP_ID && g.minRequired > 0)
      .map((g) => g.modifiers[0]!.id);
    const line = resolveOrderLine(item, itemSizes(item)[0]!.id, [...others, o.id], 1);
    check(
      `${c.label}: "${o.nameEn}" bakes the item line "${o.lineEn}"`,
      line.nameEn === o.lineEn && line.nameZh === o.lineZh,
      `stored nameEn=${JSON.stringify(line.nameEn)} nameZh=${JSON.stringify(line.nameZh)}`,
    );
    check(
      `${c.label}: "${o.nameEn}" is NOT stored as a side modifier`,
      !line.modifiers.some((m) => m.id === o.id),
      `the chosen option leaked into the modifier list: ${line.modifiers.map((m) => m.id).join(", ")}`,
    );
    // resolveChoiceLine agrees with the stored line.
    const resolved = resolveChoiceLine(item, [...others, o.id]);
    check(
      `${c.label}: resolveChoiceLine matches the stored name for "${o.nameEn}"`,
      resolved?.nameEn === o.lineEn && resolved?.choiceId === o.id,
      `resolveChoiceLine=${JSON.stringify(resolved)}`,
    );
  }
}

/* --------------------- 6. the lunch "or" is split, not nested ---- */

{
  const lunch = menu.categories.find((cat) => cat.id === "lunch-specials");
  check("lunch-specials: category exists", !!lunch);
  if (lunch) {
    const entreeMods = lunch.items.flatMap((i) =>
      i.modifierGroups
        .filter((g) => g.id !== RICE_GROUP_ID)
        .flatMap((g) => g.modifiers),
    );
    const names = new Set(entreeMods.map((m) => m.nameEn));
    check(
      "lunch: no entrée still reads 'Chicken or Beef Chow Fun (Dry)'",
      !names.has("Chicken or Beef Chow Fun (Dry)"),
      "the un-split 'or' entrée survived",
    );
    check(
      "lunch: both split chow fun entrées are present",
      names.has("Chicken Chow Fun (Dry)") && names.has("Beef Chow Fun (Dry)"),
      `chow fun entrées seen: ${[...names].filter((n) => /chow fun/i.test(n)).join(", ") || "(none)"}`,
    );
    check(
      "lunch: both split entrées carry 中文",
      entreeMods
        .filter((m) => /chow fun \(dry\)/i.test(m.nameEn))
        .every((m) => !!m.nameZh),
      entreeMods
        .filter((m) => /chow fun \(dry\)/i.test(m.nameEn))
        .map((m) => `${m.nameEn}=${m.nameZh ?? "∅"}`)
        .join(" | "),
    );
  }
}

/* --------------------------------- 7. es labels cover every option ---- */

{
  const specOptionIds: string[] = CASES.flatMap((c) =>
    c.options.map((o) => o.id as string),
  ).sort();
  const esIds = choiceOptionEsIds().sort();
  check(
    "every choice option has a staged es label",
    specOptionIds.every((id) => esIds.includes(id)),
    `missing es: ${specOptionIds.filter((id) => !esIds.includes(id)).join(", ") || "(none)"}`,
  );
  check(
    "no es label points at a dropped option id",
    esIds.every((id) => specOptionIds.includes(id)),
    `stale es: ${esIds.filter((id) => !specOptionIds.includes(id)).join(", ") || "(none)"}`,
  );
}

/* ----------- 4 & 5. it prints on the item line, distinct from the side ---- */

async function renderChecks(): Promise<void> {
  const { lines } = await composeTicketSvg(await choiceOrder(), {
    timezone: TIMEZONE,
  });
  const texts = lines.map((l) => l.text);
  // A long item name wraps across placed lines ("Beef · Chow Fun" + "(Dry)").
  // The wrapper breaks on spaces, and the name fragments are consecutive, so
  // joining every placed run with a single space reconstructs each item line —
  // which is what the kitchen reads as one line regardless of where it wrapped.
  const joined = texts.join(" ");
  const bullets = texts.filter((t) => t.startsWith("●"));

  // 4: the chosen option leads the item line, both languages, "or" gone.
  for (const expected of [
    "Beef · Chow Fun (Dry)",
    "牛 · 乾炒河粉",
    "Steamed · Dumplings (8)",
    "蒸 · 餃（8隻）",
    "Beef · Black Pepper",
    "牛 · 黑椒",
  ]) {
    check(
      `the item line "${expected}" prints`,
      joined.includes(expected),
      `not found in placed text: ${joined}`,
    );
  }

  // The unresolved "…or…" name must never reach paper.
  check(
    "no unresolved 'or' name prints (English)",
    !texts.some((t) => /\bor\b/i.test(t)),
    `an 'or' survived: ${texts.filter((t) => /\bor\b/i.test(t)).join(" | ")}`,
  );
  check(
    "no unresolved 或 prints (中文)",
    !texts.some((t) => t.includes("或")),
    `a 或 survived: ${texts.filter((t) => t.includes("或")).join(" | ")}`,
  );

  // 5: the ONLY ● side on this whole order is Black Pepper's rice. Asserting
  // the exact bullet set is what proves no chosen protein leaked onto a side —
  // a needle like "Steamed" would false-match the legitimate "Steamed Rice"
  // bullet, so the set, not a substring, is the honest check.
  check(
    "the only ● side is Black Pepper's steamed rice",
    bullets.length === 1 && bullets[0] === "● 白飯 / Steamed Rice",
    `bullets seen: ${bullets.join(" | ") || "(none)"}`,
  );
}

async function main(): Promise<void> {
  await renderChecks();

  const total = pass + failures.length;
  console.log(`choice: ${pass}/${total} checks passed`);
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
