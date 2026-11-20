/**
 * verify:tray-sizes — the HALF TRAY tier, end to end.
 *
 * The restaurant wrote a "small" tray price by hand beside every printed
 * party-tray price (Nov 2026). It ships as a third size, `half-tray`, between
 * Individual and Party Tray, on the staff POS only. This script holds the
 * contract:
 *
 *   1. shape      every dish sold by the tray has exactly individual /
 *                 half-tray / party-tray, in that order, strictly ascending,
 *                 and no dish has a half tray without a full one
 *   2. rice       a half tray is the dish alone, like the full tray
 *   3. POS        the strip's 半盤 default lands a half tray with one tap on a
 *                 tray dish, and leaves every other dish exactly as before
 *   4. server     POST /api/orders (the website) refuses a half-tray line;
 *                 the staff route accepts it, prices it from the catalogue,
 *                 and moves the order to the long prep window
 *   5. ticket     the chip reads 【半盤 HALF TRAY】, never a bare HALF that
 *                 could be read as half a duck
 */

import { catalogMenu } from "@/lib/menu/catalog";
import { customerSizes, isTraySize, itemSizes, type MenuItem } from "@/lib/menu/types";
import { groupsForSize, RICE_GROUP_ID } from "@/lib/menu/rice";
import { composeOrder } from "@/lib/orders/compose";
import { defaultSizeId, quickAdd, INITIAL_DEFAULTS, sellsTrays } from "@/lib/kitchen/posDefaults";
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
check(
  "the half tray is staff-only: the website's size list never has it",
  items.every((it) => !customerSizes(it).some((s) => s.id === "half-tray")) &&
    trayDishes.every((it) => customerSizes(it).map((s) => s.id).join(",") === "individual,party-tray"),
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
check("the strip's 半盤 lands a half tray", defaultSizeId(kungPao, "half") === "half-tray");
check("the strip's 餐盤 still lands the full tray", defaultSizeId(kungPao, "tray") === "party-tray");
check("the strip's 單點 still lands the individual", defaultSizeId(kungPao, "individual") === "individual");
const halfTap = quickAdd(kungPao, { ...INITIAL_DEFAULTS, size: "half" });
check(
  "one tap with 半盤 set adds a half tray with no rice and asks nothing",
  halfTap.kind === "add" && halfTap.line.sizeId === "half-tray" && halfTap.line.modifierIds.length === 0,
  JSON.stringify(halfTap),
);
const nonTray = items.filter((it) => !sellsTrays(it));
check(
  "every dish not sold by the tray resolves the same size under 半盤 as under 單點",
  nonTray.every((it) => defaultSizeId(it, "half") === defaultSizeId(it, "individual")),
  nonTray.filter((it) => defaultSizeId(it, "half") !== defaultSizeId(it, "individual")).map((it) => it.id).join(", "),
);

/* ------------------------------------------------------ 4. server ---- */

const line = { itemId: "kung-pao-chicken", sizeId: "half-tray", modifierIds: [], quantity: 2 };
const web = composeOrder(menu, [line], { taxRateBps: 875, lunchAllowed: true });
check("the website's order route refuses a half-tray line", !web.ok, JSON.stringify(web));
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
