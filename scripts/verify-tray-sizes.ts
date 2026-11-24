/**
 * verify:tray-sizes — the HALF TRAY tier, end to end.
 *
 * The restaurant wrote a "small" tray price by hand beside every printed
 * party-tray price (Nov 2026). It ships as a third size, `half-tray`, between
 * Individual and Party Tray, on the POS and the website alike. This script
 * holds the contract:
 *
 *   1. shape      every dish sold by the tray has exactly individual /
 *                 half-tray / party-tray, in that order, strictly ascending,
 *                 and no dish has a half tray without a full one
 *   2. rice       a half tray is the dish alone, like the full tray
 *   3. POS        a tap on a tray dish opens the portion sheet (no size is
 *                 ever a default), and its 半盤 adds a half tray with no rice
 *   4. server     the website's order route and the staff route both accept
 *                 a half-tray line, price it from the catalogue, and move the
 *                 order to the long prep window
 *   5. ticket     the chip reads 【半盤 HALF TRAY】, never a bare HALF that
 *                 could be read as half a duck
 */

import { catalogMenu } from "@/lib/menu/catalog";
import { isTraySize, itemSizes, type MenuItem } from "@/lib/menu/types";
import { groupsForSize, RICE_GROUP_ID } from "@/lib/menu/rice";
import { composeOrder } from "@/lib/orders/compose";
import { lineAt, sellsTrays, tapRule } from "@/lib/kitchen/posTap";
import { resolveSizeZh } from "@/data/menu-overrides";
import { composeTicketSvg } from "@/lib/ticket/render";
import { fixtureOrder } from "./fixtures/orders";

let pass = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) pass++;
  else failures.push(`  ${name}${detail ? `\n     ${detail}` : ""}`);
};

const menu = catalogMenu();
const items = menu.categories.flatMap((c) => c.items);
const trayDishes = items.filter(sellsTrays);
const ids = (it: MenuItem) => itemSizes(it).map((s) => s.id).join(",");

/* ------------------------------------------------------- 1. shape ---- */

check("there are tray dishes to check", trayDishes.length >= 100, `saw ${trayDishes.length}`);
check(
  "every tray dish sells individual, half-tray, party-tray in that order",
  trayDishes.every((it) => ids(it) === "individual,half-tray,party-tray"),
  trayDishes.filter((it) => ids(it) !== "individual,half-tray,party-tray").map((it) => `${it.id}: ${ids(it)}`).join("; "),
);
check(
  "every tray dish prices strictly ascending",
  trayDishes.every((it) => {
    const [a, b, c] = itemSizes(it).map((s) => s.priceCents);
    return a < b && b < c;
  }),
  trayDishes
    .filter((it) => {
      const [a, b, c] = itemSizes(it).map((s) => s.priceCents);
      return !(a < b && b < c);
    })
    .map((it) => it.id)
    .join(", "),
);
check(
  "a half tray is roughly half a full tray (50–70%), so a mis-keyed digit shows",
  trayDishes.every((it) => {
    const [, half, full] = itemSizes(it).map((s) => s.priceCents);
    return half >= full * 0.5 && half <= full * 0.7;
  }),
  trayDishes
    .filter((it) => {
      const [, half, full] = itemSizes(it).map((s) => s.priceCents);
      return !(half >= full * 0.5 && half <= full * 0.7);
    })
    .map((it) => `${it.id} ${itemSizes(it)[1].priceCents}/${itemSizes(it)[2].priceCents}`)
    .join(", "),
);
check(
  "no dish has a half tray without a full tray",
  items.every((it) => !itemSizes(it).some((s) => s.id === "half-tray") || sellsTrays(it)),
);
check("isTraySize knows both trays and nothing else", isTraySize("half-tray") && isTraySize("party-tray") && !isTraySize("individual") && !isTraySize("half"));

/* -------------------------------------------------------- 2. rice ---- */

const riceDishes = trayDishes.filter((it) => it.modifierGroups.some((g) => g.id === RICE_GROUP_ID));
check("there are rice-bearing tray dishes to check", riceDishes.length >= 80, `saw ${riceDishes.length}`);
check(
  "a half tray has no rice group, like the full tray; the individual keeps it",
  riceDishes.every(
    (it) =>
      !groupsForSize(it, "half-tray").some((g) => g.id === RICE_GROUP_ID) &&
      !groupsForSize(it, "party-tray").some((g) => g.id === RICE_GROUP_ID) &&
      groupsForSize(it, "individual").some((g) => g.id === RICE_GROUP_ID),
  ),
);

/* --------------------------------------------------------- 3. POS ---- */

const kungPao = items.find((it) => it.id === "kung-pao-chicken")!;
const tap = tapRule(kungPao);
check(
  "a tap on a tray dish opens the portion sheet on its three sizes",
  tap.kind === "portion" && tap.sizes.map((x) => x.id).join() === "individual,half-tray,party-tray",
  JSON.stringify(tap),
);
check(
  "every tray dish's tap opens the portion sheet: no size is a default",
  trayDishes.every((it) => tapRule(it).kind === "portion"),
  trayDishes.filter((it) => tapRule(it).kind !== "portion").map((it) => it.id).join(", "),
);
const halfTap = lineAt(kungPao, "half-tray");
check(
  "半盤 on the portion sheet adds a half tray with no rice and asks nothing",
  halfTap.kind === "add" && halfTap.line.sizeId === "half-tray" && halfTap.line.modifierIds.length === 0,
  JSON.stringify(halfTap),
);
const oneTap = lineAt(kungPao, "individual");
check(
  "單點 adds the individual with 白飯 steamed, the menu's default, and asks nothing",
  oneTap.kind === "add" && oneTap.line.modifierIds.join() === "rice-steamed",
  JSON.stringify(oneTap),
);
const oneSize = items.filter((it) => itemSizes(it).length === 1);
check(
  "a one-size dish never opens the portion sheet",
  oneSize.length > 0 && oneSize.every((it) => tapRule(it).kind !== "portion"),
);

/* ------------------------------------------------------ 4. server ---- */

const line = { itemId: "kung-pao-chicken", sizeId: "half-tray", modifierIds: [], quantity: 2 };
const web = composeOrder(menu, [line], { taxRateBps: 875, lunchAllowed: true });
check("the website's order route accepts a half-tray line", web.ok, JSON.stringify(web));
const staff = composeOrder(menu, [line], { taxRateBps: 875, lunchAllowed: true, allowStaffOnly: true });
check("the staff route accepts it", staff.ok, JSON.stringify(staff));
if (staff.ok) {
  check("priced from the catalogue: 2 × $52.00", staff.totals.subtotalCents === 10400, `${staff.totals.subtotalCents}`);
  check("a half tray moves the order to the long prep window", staff.hasLongPrep);
  check("the stored line carries the 中文 size label", staff.lines[0].sizeLabelZh === "半盤", JSON.stringify(staff.lines[0]));
}

/* ------------------------------------------------------ 5. ticket ---- */

check("resolveSizeZh knows the half tray", resolveSizeZh("Half Tray") === "半盤");

async function ticketChecks(): Promise<void> {
  if (!staff.ok) return;
  const { lines: placed } = await composeTicketSvg(
    { ...fixtureOrder(), items: staff.lines, totals: { ...fixtureOrder().totals, ...staff.totals } },
    { timezone: "America/Los_Angeles" },
  );
  const texts = placed.map((l) => l.text);
  check(
    "the kitchen ticket prints 【半盤 HALF TRAY】 on the item line",
    texts.some((t) => t.includes("【半盤 HALF TRAY】")),
    texts.filter((t) => t.includes("【")).join(" | ") || "(no chip)",
  );
  check("and never a bare HALF chip", !texts.some((t) => t.includes("【半盤 HALF】") || t.includes("【HALF】")));
}

/* ------------------------------------------------------------ out ---- */

ticketChecks().then(() => {
  if (failures.length) {
    console.log(`\nFAILED:\n${failures.join("\n")}\n`);
    console.log(`tray sizes: ${pass} passed, ${failures.length} failed`);
    process.exit(1);
  }
  console.log(`tray sizes: ${pass}/${pass} checks passed (${trayDishes.length} tray dishes)`);
});
