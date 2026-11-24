import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E_KITCHEN_PASSWORD } from "./env";
import { enableTestMode } from "./testMode";
import { tapDish } from "./posSheet";

/**
 * The POS speed design, Revision 3 (docs/kitchen-design.md): no defaults.
 *
 *   TOP    the category chips, 午餐 Lunch and search; nothing that decides
 *   GRID   a one-size dish adds at once; a dish sold in portions opens the
 *          份量 Portion sheet, where one tap picks the size and adds; the 改
 *          corner opens the full sheet
 *   RICE   a rice dish adds with 白飯, the menu's default, and never asks;
 *          rice it does not include is #116 on its own line (加飯)
 *   RIGHT  the ticket: tap a line to change it, − / + on the line
 *
 * Every test starts on a fresh tablet, signed in to the throwaway e2e server.
 */

/** Rice dishes sold 單點 / 半盤 / 餐盤 with no other required choice. */
const ORANGE = 'button[data-item]:not([data-asks])[aria-label*="Orange Flavored Chicken"]';
const MONGOLIAN = 'button[data-item]:not([data-asks])[aria-label*="Mongolian Beef"]';
/** "Black Pepper Beef or Chicken": the pick is the dish, never defaulted. */
const OR_DISH = 'button[data-item="black-pepper-beef-or-chicken"]';
/** 春卷 Egg Rolls: one size, no choices. */
const EGG_ROLLS = 'button[data-item="egg-rolls"]';

async function openPos(browser: Browser, viewport = { width: 1024, height: 768 }): Promise<Page> {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
  const page = await context.newPage();
  await enableTestMode(page);
  await page.goto("/kitchen/pos");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  // Landscape prints from the ticket column, portrait from the bottom bar.
  await expect(page.locator('[data-action="print"]:visible, [data-action="bar-print"]:visible')).toBeVisible();
  return page;
}

/** Portrait keeps the ticket in a sheet: open it when the bar is showing. */
async function showTicket(page: Page): Promise<void> {
  const open = page.locator('[data-action="open-ticket"]');
  if (await open.isVisible()) await open.click();
}

const ticketOf = (page: Page) => page.locator("[data-ticket]");
const linesOf = (page: Page) => ticketOf(page).locator("[data-line]");
const portionSheet = (page: Page) => page.locator('[data-sheet="portion"]');

/** A walk-in needs no phone, so Print is ready as soon as there is a line. */
async function walkIn(page: Page): Promise<void> {
  await page.locator('[data-context="takeout"]').click();
  await page.locator('[data-channel="walk_in"]').click();
  await page.locator('[data-action="details-done"]').click();
}

test("the top row has no defaults: chips, 午餐 and search only, on one row at 1024", async ({ browser }) => {
  const page = await openPos(browser);
  await expect(page.locator("[data-defaults], [data-action='apply-rice-all']")).toHaveCount(0);
  const toolbar = page.locator('[role="toolbar"]');
  const fits = await toolbar.evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits, "the toolbar fits its column at 1024").toBe(true);
  await expect(toolbar.locator('button[aria-label="搜尋菜名或編號"]')).toBeInViewport({ ratio: 1 });
  // The chips share the row: their top is the toolbar's.
  const chips = await page.locator('nav[aria-label] button').first().boundingBox();
  const search = await toolbar.locator('button[aria-label="搜尋菜名或編號"]').boundingBox();
  expect(Math.abs(chips!.y + chips!.height / 2 - (search!.y + search!.height / 2))).toBeLessThan(4);
  // The old per-tablet choices are cleared.
  expect(await page.evaluate(() => [localStorage.getItem("nmc-pos-rice"), localStorage.getItem("nmc-pos-size")])).toEqual([null, null]);
  await page.context().close();
});

test("a tray dish opens the portion sheet, and one tap adds that size", async ({ browser }) => {
  const page = await openPos(browser);
  await page.locator(MONGOLIAN).first().click();
  const sheet = portionSheet(page);
  await expect(sheet).toBeVisible();
  await expect(linesOf(page)).toHaveCount(0);
  const portions = sheet.locator("[data-portion]");
  await expect(portions).toHaveCount(3);
  await expect(portions.nth(0)).toContainText("單點");
  await expect(portions.nth(1)).toContainText("半盤");
  await expect(portions.nth(1)).toContainText("$45.00");
  await expect(portions.nth(2)).toContainText("餐盤");
  // A new ticket highlights 單點 (a cue, not a choice), and focus is on it.
  await expect(sheet.locator("[data-highlight]")).toHaveAttribute("data-portion", "individual");
  await expect(portions.nth(0)).toBeFocused();

  // One tap: 半盤 goes on, the sheet closes. A tray is the dish alone: no rice.
  await portions.nth(1).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(linesOf(page)).toHaveCount(1);
  await expect(linesOf(page).first()).toContainText("半盤");
  await expect(linesOf(page).first()).not.toContainText("飯 /");
  await expect(linesOf(page).first()).toContainText("$45.00");

  // The next tray dish highlights 半盤, the last portion on THIS ticket.
  await page.locator(ORANGE).first().click();
  await expect(sheet.locator("[data-highlight]")).toHaveAttribute("data-portion", "half-tray");
  // Keys: 3 adds 餐盤 directly.
  await page.keyboard.press("3");
  await expect(linesOf(page)).toHaveCount(2);
  await expect(linesOf(page).nth(1)).toContainText("餐盤");

  // Esc and the scrim close it without adding anything.
  await page.locator(ORANGE).first().click();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(linesOf(page)).toHaveCount(2);

  // A new ticket starts on 單點 again.
  await ticketOf(page).getByRole("button", { name: "清除單據" }).click();
  await page.getByRole("dialog", { name: "清除這張單據？" }).getByRole("button", { name: "確認清除" }).click();
  await expect(linesOf(page)).toHaveCount(0);
  await page.locator(ORANGE).first().click();
  await expect(sheet.locator("[data-highlight]")).toHaveAttribute("data-portion", "individual");
  await page.context().close();
});

test("a single-size dish adds at once, with no sheet", async ({ browser }) => {
  const page = await openPos(browser);
  await expect(page.locator(EGG_ROLLS)).not.toHaveAttribute("data-portions");
  await page.locator(EGG_ROLLS).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(linesOf(page)).toHaveCount(1);
  await expect(linesOf(page).first()).toContainText("春卷");
  await page.context().close();
});

test("a rice dish adds with 白飯 steamed and never asks about rice", async ({ browser }) => {
  const page = await openPos(browser);
  await tapDish(page, page.locator(ORANGE).first(), "individual");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(linesOf(page)).toHaveCount(1);
  await expect(linesOf(page).first()).toContainText("白飯");
  await expect(linesOf(page).first()).toContainText("單點");
  await page.context().close();
});

test("加飯 in the ticket footer adds a priced #116 Fried/Steamed Rice line that prints", async ({ browser }) => {
  const page = await openPos(browser);
  const addRice = ticketOf(page).locator('[data-action="add-rice"]');
  await expect(addRice).toContainText("加飯");
  await expect(addRice).toContainText("$3.00");
  await addRice.click();
  await expect(linesOf(page)).toHaveCount(1);
  const line = linesOf(page).first();
  await expect(line).toContainText("炒飯／白飯");
  await expect(line).toContainText("白飯");
  await expect(line).toContainText("$3.00");
  // Again bumps the same line.
  await addRice.click();
  await expect(linesOf(page)).toHaveCount(1);
  await expect(line.locator("[data-qty]")).toHaveText("2");
  await expect(line).toContainText("$6.00");

  await walkIn(page);
  await page.locator('[data-action="print"]').click();
  const sent = page.locator('[data-ticket] [role="status"]').filter({ hasText: /\w-\d{3}/ });
  await expect(sent).toBeVisible();
  const number = (await sent.locator("span").nth(0).textContent())?.trim() ?? "";
  const order = await page.evaluate(async (n) => {
    const res = await fetch("/api/kitchen/orders", { cache: "no-store" });
    const all = ((await res.json()) as { orders: { id: number; orderNumber: string; items: Record<string, unknown>[] }[] }).orders;
    return all.find((o) => o.orderNumber === n)!;
  }, number);
  expect(order.items).toHaveLength(1);
  expect(order.items[0]).toMatchObject({ itemId: "fried-steamed-rice", sizeId: "individual", quantity: 2, unitCents: 300, lineCents: 600 });
  const kitchen = await page.evaluate(async (id) => {
    const res = await fetch(`/api/kitchen/orders/${id}/ticket?copy=kitchen&format=text`, { cache: "no-store" });
    return ((await res.json()) as { lines: string[] }).lines.join("\n");
  }, order.id);
  // Its own line on the wok's copy: #116 prints as its preparation, 白飯 Steamed Rice, ×2.
  expect(kitchen).toMatch(/×2\nSteamed Rice\n白飯/);
  await page.context().close();
});

test("the 改 sheet's 加飯 row shows on a size with no rice and adds #116 as its own lines", async ({ browser }) => {
  const page = await openPos(browser);
  await page.locator('[data-modify="mongolian-beef"]').first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  // 單點 includes rice: no 加飯 row.
  await expect(sheet.locator('[data-section="add-rice"]')).toHaveCount(0);
  await sheet.locator('[data-section="size"] button[aria-pressed]', { hasText: "半盤" }).click();
  const row = sheet.locator('[data-section="add-rice"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText("+$3.00");
  await row.locator('[data-action="rice-more"]').click();
  await row.locator('[data-action="rice-more"]').click();
  await expect(row.locator("[data-rice-count]")).toHaveText("2");
  await expect(sheet.locator('[data-action="sheet-add"]')).toContainText("$51.00");
  await sheet.locator('[data-action="sheet-add"]').click();
  await expect(sheet).toHaveCount(0);
  await expect(linesOf(page)).toHaveCount(2);
  await expect(linesOf(page).nth(0)).toContainText("半盤");
  await expect(linesOf(page).nth(1)).toContainText("炒飯／白飯");
  await expect(linesOf(page).nth(1).locator("[data-qty]")).toHaveText("2");
  await page.context().close();
});

test("a tray dish with a required choice asks the portion, then the choice, and cannot be added without it", async ({ browser }) => {
  const page = await openPos(browser);
  // Marked so staff know the tap will ask.
  await expect(page.locator(OR_DISH)).toHaveAttribute("data-asks", "true");
  await page.locator(OR_DISH).click();
  await portionSheet(page).locator('[data-portion="individual"]').click();

  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(linesOf(page)).toHaveCount(0);

  // Only the beef-or-chicken section is open; the rice is 白飯, the menu's default.
  await expect(sheet.locator('button[aria-expanded="true"]')).toHaveCount(1);
  const choice = sheet.locator("fieldset").filter({ has: page.locator("legend", { hasText: "Beef or chicken" }) });
  await expect(choice.locator("legend button")).toHaveAttribute("aria-expanded", "true");
  await expect(choice.locator('button[aria-pressed="true"]')).toHaveCount(0);
  await expect(sheet.locator("fieldset").filter({ has: page.locator("legend", { hasText: "Rice" }) })).toContainText("白飯");
  // Focus starts on that choice.
  await expect(choice.locator("button[aria-pressed]").first()).toBeFocused();

  const add = sheet.locator('[data-action="sheet-add"]');
  await expect(add).toBeDisabled();
  await expect(sheet).toContainText("請先選擇");
  await add.click({ force: true });
  await expect(linesOf(page)).toHaveCount(0);

  // Tab stays inside the sheet.
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);

  await choice.locator("button[aria-pressed]").first().click();
  await expect(add).toBeEnabled();
  await add.click();
  await expect(sheet).toHaveCount(0);
  await expect(linesOf(page)).toHaveCount(1);
  await expect(linesOf(page).first()).toContainText("白飯");

  // Esc closes the portion sheet and focus goes back to the tile.
  await page.locator(OR_DISH).click();
  await expect(portionSheet(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(portionSheet(page)).toHaveCount(0);
  await expect(page.locator(OR_DISH)).toBeFocused();
  await page.context().close();
});

test("tapping a tile twice bumps its line's quantity", async ({ browser }) => {
  const page = await openPos(browser);
  await tapDish(page, page.locator(ORANGE).first());
  await tapDish(page, page.locator(ORANGE).first());
  await expect(linesOf(page)).toHaveCount(1);
  await expect(linesOf(page).first().locator("[data-qty]")).toHaveText("2");

  // A different portion is a different line, not a bump.
  await tapDish(page, page.locator(ORANGE).first(), "half-tray");
  await expect(linesOf(page)).toHaveCount(2);
  await page.context().close();
});

test("minus at 1 removes the line with no confirm, and Undo restores it", async ({ browser }) => {
  const page = await openPos(browser);
  await tapDish(page, page.locator(ORANGE).first());
  await tapDish(page, page.locator(MONGOLIAN).first());
  await expect(linesOf(page)).toHaveCount(2);
  const first = await linesOf(page).first().textContent();

  await linesOf(page).first().locator('[data-step="minus"]').click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(linesOf(page)).toHaveCount(1);

  const toast = page.getByRole("status").filter({ hasText: "已移除" });
  await toast.locator('[data-action="toast-action"]').click();
  await expect(linesOf(page)).toHaveCount(2);
  await expect(linesOf(page).first()).toHaveText(first ?? "");
  await page.context().close();
});

test("tapping a line opens its sheet and Update changes it in place", async ({ browser }) => {
  const page = await openPos(browser);
  await tapDish(page, page.locator(ORANGE).first());
  await tapDish(page, page.locator(MONGOLIAN).first());
  await linesOf(page).first().locator("button[aria-haspopup]").click();
  const sheet = page.getByRole("dialog");
  const riceGroup = sheet.locator("fieldset").filter({ has: page.locator("legend", { hasText: "Rice" }) });
  await expect(riceGroup.locator('button[aria-pressed="true"]')).toContainText("白飯");
  await riceGroup.locator("button[aria-pressed]", { hasText: "炒飯" }).click();
  await sheet.getByRole("button", { name: /更新單據/ }).click();
  await expect(linesOf(page)).toHaveCount(2);
  await expect(linesOf(page).first()).toContainText("炒飯");
  await expect(linesOf(page).first()).toContainText("Orange");
  await page.context().close();
});

for (const viewport of [
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1366, height: 1024 },
]) {
  test(`the ticket never scrolls sideways at ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    const page = await openPos(browser, viewport);
    // Long names, every option on the line, and a long note.
    const tiles = page.locator("button[data-item]:not([disabled]):not([data-asks])");
    for (const i of [0, 1, 2, 4, 6, 8]) await tapDish(page, tiles.nth(i));
    await showTicket(page);
    await linesOf(page).first().locator("button[aria-haspopup]").click();
    const sheet = page.locator('[role="dialog"]:not([data-ticket])');
    const notesHead = sheet.locator('[data-section="instructions"] button[aria-expanded]');
    if ((await notesHead.getAttribute("aria-expanded")) !== "true") await notesHead.click();
    await sheet.getByRole("textbox", { name: "特別要求" }).fill("Extra spicy, no onions, sauce on the side, cut in small pieces please");
    await sheet.getByRole("button", { name: /更新單據/ }).click();
    await expect(linesOf(page)).toHaveCount(6);

    const overflow = await ticketOf(page).evaluate((aside) =>
      [aside, ...aside.querySelectorAll<HTMLElement>("*")]
        .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "hidden" && getComputedStyle(el).overflowX !== "clip")
        .filter((el) => !(getComputedStyle(el).textOverflow === "ellipsis"))
        .map((el) => `${el.tagName}.${el.className}`),
    );
    expect(overflow).toEqual([]);
    const sideways = await ticketOf(page).evaluate((aside) => {
      const list = aside.querySelector<HTMLElement>("[data-line]")!.parentElement!;
      list.scrollLeft = 100;
      aside.scrollLeft = 100;
      return list.scrollLeft + aside.scrollLeft;
    });
    expect(sideways).toBe(0);
    // Each line sits inside the ticket.
    const box = await ticketOf(page).boundingBox();
    for (const line of await linesOf(page).all()) {
      const b = await line.boundingBox();
      expect(b!.x).toBeGreaterThanOrEqual(box!.x - 0.5);
      expect(b!.x + b!.width).toBeLessThanOrEqual(box!.x + box!.width + 0.5);
    }
    await page.context().close();
  });
}

test("no touch target on the POS is under 44px", async ({ browser }) => {
  const page = await openPos(browser);
  const tiles = page.locator("button[data-item]:not([disabled]):not([data-asks])");
  for (const i of [0, 1, 2, 4, 6, 8]) await tapDish(page, tiles.nth(i));
  await linesOf(page).first().locator('[data-step="plus"]').click();

  const small = async () =>
    page.evaluate(() => {
      const targets = document.querySelectorAll<HTMLElement>(
        "[data-pos-screen] :is(button, input, select, textarea, a[href]), [role=dialog] :is(button, textarea)",
      );
      const out: string[] = [];
      for (const el of targets) {
        if (el.closest('[aria-hidden="true"]') || el.tabIndex < 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue; // not rendered
        // Only what is on screen: a tile scrolled out of its pane is not a target now.
        if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
        if (r.width < 43.5 || r.height < 43.5) {
          out.push(`${el.tagName} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return out;
    });

  expect(await small()).toEqual([]);
  // With the portion sheet open.
  await page.locator("button[data-item][data-portions]").first().click();
  await expect(portionSheet(page)).toBeVisible();
  expect(await small()).toEqual([]);
  await page.keyboard.press("Escape");
  // With the sheet open, every section expanded.
  await page.locator('button[data-modify]').first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  for (const head of await sheet.locator('button[aria-expanded="false"]').all()) await head.click();
  expect(await small()).toEqual([]);
  await page.context().close();
});

test("keyboard: / searches, Enter then 2 adds the second result, Esc clears; typing digits only searches", async ({ browser }) => {
  const page = await openPos(browser);
  await page.locator("body").press("/");
  const search = page.getByRole("textbox", { name: "搜尋菜名或編號" });
  await expect(search).toBeFocused();

  // Digits typed in the field are a menu-number search, never an add.
  await page.keyboard.type("12");
  await expect(search).toHaveValue("12");
  await expect(linesOf(page)).toHaveCount(0);

  await search.fill("beef");
  const results = page.locator('section[aria-label] button[data-item]');
  const second = (await results.nth(1).getAttribute("aria-label")) ?? "";
  await search.press("Enter");
  await expect(search).not.toBeFocused();
  await page.keyboard.press("2");
  // A dish sold in portions asks; 1 on the portion sheet is 單點.
  if ((await portionSheet(page).count()) > 0) await page.keyboard.press("1");
  await expect(linesOf(page)).toHaveCount(1);
  await expect(linesOf(page).first()).toContainText(second.split(" ")[0]);
  await expect(linesOf(page).first()).toContainText("白飯");

  // Esc out of the field clears the search.
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(page.locator("[data-cat]").first()).toBeVisible();

  // Esc in the field clears the query first.
  await page.locator("body").press("/");
  await page.keyboard.type("rice");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "搜尋菜名或編號" })).toHaveValue("");
  await page.context().close();
});
