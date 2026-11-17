import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E_KITCHEN_PASSWORD } from "./env";
import { enableTestMode } from "./testMode";

/**
 * The POS: one tap per dish in the common case.
 *
 *   TABS   nine, every dish in one scroll
 *   GRID   a card adds; a dish with rice opens the rice picker on the card,
 *          and a second tap takes 白飯; the 餐盤 pill adds the tray
 *   TICKET tap a line for its quick notes and 改; − / + on the line
 *
 * Every test starts on a fresh tablet, signed in to the throwaway e2e
 * server. 常點 Popular comes first, so a dish can be on screen twice:
 * `.first()` is the Popular card.
 */

/** A rice dish sold 單點 and 餐盤 with no other required choice. */
const ORANGE = 'button[data-item="orange-flavored-chicken-special"]';
const MONGOLIAN = 'button[data-item="mongolian-beef-special"]';
/** No rice, one size: one tap adds. */
const EGG_ROLLS = 'button[data-item="egg-rolls"]';
/** "Black Pepper Beef or Chicken": the pick is the dish, never defaulted. */
const OR_DISH = 'button[data-item="black-pepper-beef-or-chicken"]';

async function openPos(browser: Browser, viewport = { width: 1024, height: 768 }): Promise<Page> {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
  const page = await context.newPage();
  await enableTestMode(page);
  await page.goto("/kitchen/pos");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  // Landscape shows the side ticket's Send; upright, the bar's.
  await expect(page.locator('[data-action="print"], [data-action="send"]').filter({ visible: true })).toHaveCount(1);
  return page;
}

const ticketOf = (page: Page) => page.getByRole("complementary", { name: "單據" });
const linesOf = (page: Page) => ticketOf(page).locator("[data-line]");
const ricePop = (page: Page) => page.locator("[data-rice-pop]");
const riceBtn = (page: Page, value: string) => ricePop(page).locator(`button[data-rice="${value}"]`);

/** Tap a card the way staff do: once, and take 白飯 if it asks for rice. */
async function add(page: Page, card: ReturnType<Page["locator"]>): Promise<void> {
  await card.click();
  if (await ricePop(page).isVisible()) await card.click();
}

test("a dish with no rice adds in one tap; a rice dish asks on the card", async ({ browser }) => {
  const page = await openPos(browser);
  await page.locator(EGG_ROLLS).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(ricePop(page)).toHaveCount(0);
  await expect(linesOf(page)).toHaveCount(1);

  // Rice: the picker on the card, four choices offered as the dish allows,
  // 白飯 first. 炒飯 adds it.
  await page.locator(ORANGE).first().click();
  await expect(ricePop(page)).toBeVisible();
  await expect(ricePop(page).locator("button").first()).toHaveAttribute("data-rice", "steamed");
  await expect(linesOf(page)).toHaveCount(1);
  await riceBtn(page, "fried").click();
  await expect(ricePop(page)).toHaveCount(0);
  await expect(linesOf(page)).toHaveCount(2);
  await expect(linesOf(page).nth(1)).toContainText("炒飯");
  await expect(linesOf(page).nth(1)).toContainText("單點");
  // The card shows how many are on the ticket.
  await expect(page.locator('[data-tile-key="popular:orange-flavored-chicken-special"] [data-qty-badge]')).toHaveText("1");
  await page.context().close();
});

test("tapping a rice card twice adds it with 白飯; a tap elsewhere or Esc closes the picker", async ({ browser }) => {
  const page = await openPos(browser);
  await page.locator(MONGOLIAN).first().click();
  await page.locator(MONGOLIAN).first().click();
  await expect(ricePop(page)).toHaveCount(0);
  await expect(linesOf(page)).toHaveCount(1);
  await expect(linesOf(page).first()).toContainText("白飯");

  await page.locator(ORANGE).first().click();
  await expect(ricePop(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(ricePop(page)).toHaveCount(0);
  await page.locator(ORANGE).first().click();
  await page.locator(EGG_ROLLS).first().click();
  await expect(ricePop(page)).toHaveCount(0);
  await expect(linesOf(page)).toHaveCount(2);
  await page.context().close();
});

test("the 餐盤 pill adds the tray, with no rice", async ({ browser }) => {
  const page = await openPos(browser);
  await page.locator('[data-tile-key="popular:mongolian-beef-special"] button[data-tray]').click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(ricePop(page)).toHaveCount(0);
  await expect(linesOf(page)).toHaveCount(1);
  await expect(linesOf(page).first()).toContainText("餐盤");
  await expect(linesOf(page).first()).not.toContainText("飯 /");
  await page.context().close();
});

test("a required-choice dish opens on that choice and cannot be added without it", async ({ browser }) => {
  const page = await openPos(browser);
  // Marked so staff know the tap will ask.
  await expect(page.locator(OR_DISH)).toHaveAttribute("data-asks", "true");
  await page.locator(OR_DISH).click();

  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(linesOf(page)).toHaveCount(0);

  // Only the beef-or-chicken section is open; the rice starts at 白飯.
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

  // Esc closes the sheet and focus goes back to the tile.
  await page.locator(OR_DISH).click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(page.locator(OR_DISH)).toBeFocused();
  await page.context().close();
});

test("the same dish again bumps its line's quantity; another rice is another line", async ({ browser }) => {
  const page = await openPos(browser);
  await add(page, page.locator(ORANGE).first());
  await add(page, page.locator(ORANGE).first());
  await expect(linesOf(page)).toHaveCount(1);
  await expect(linesOf(page).first().locator("[data-qty]")).toHaveText("2");

  await page.locator(ORANGE).first().click();
  await riceBtn(page, "fried").click();
  await expect(linesOf(page)).toHaveCount(2);
  await page.context().close();
});

test("minus at 1 removes the line with no confirm, and Undo restores it", async ({ browser }) => {
  const page = await openPos(browser);
  await add(page, page.locator(ORANGE).first());
  await add(page, page.locator(MONGOLIAN).first());
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

test("tapping a line shows its quick notes; 改 opens the sheet and Update changes it in place", async ({ browser }) => {
  const page = await openPos(browser);
  await add(page, page.locator(ORANGE).first());
  await add(page, page.locator(MONGOLIAN).first());
  const first = linesOf(page).first();
  await first.locator("button[aria-expanded]").click();
  await first.locator('[data-note="走辣 No spicy"]').click();
  await expect(first.locator('[data-note="走辣 No spicy"]')).toHaveAttribute("aria-pressed", "true");
  await expect(first).toContainText("走辣 No spicy");

  await first.locator('[data-action="edit-line"]').click();
  const sheet = page.getByRole("dialog");
  const riceGroup = sheet.locator("fieldset").filter({ has: page.locator("legend", { hasText: "Rice" }) });
  await expect(riceGroup.locator('button[aria-pressed="true"]')).toContainText("白飯");
  await riceGroup.locator("button[aria-pressed]", { hasText: "炒飯" }).click();
  await sheet.getByRole("button", { name: /更新單據/ }).click();
  await expect(linesOf(page)).toHaveCount(2);
  await expect(linesOf(page).first()).toContainText("炒飯");
  await expect(linesOf(page).first()).toContainText("Orange");
  await expect(linesOf(page).first()).toContainText("走辣");
  await page.context().close();
});

/** Upright, the ticket is a sheet behind the bar: open it. */
async function showTicket(page: Page): Promise<void> {
  const bar = page.locator('[data-action="open-ticket"]');
  if (await bar.isVisible()) await bar.click();
}

for (const viewport of [
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1366, height: 1024 },
]) {
  test(`the ticket never scrolls sideways at ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    const page = await openPos(browser, viewport);
    // Long names, every option on the line, and a long note.
    const tiles = page.locator("button[data-item]:not([disabled]):not([data-asks])");
    for (const i of [0, 1, 2, 4, 6, 8]) {
      await tiles.nth(i).click();
      if (await ricePop(page).isVisible()) await riceBtn(page, "none").click();
    }
    await showTicket(page);
    await linesOf(page).first().locator("button[aria-expanded]").click();
    await linesOf(page).first().locator('[data-action="edit-line"]').click();
    const sheet = page.getByRole("dialog");
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
  for (const i of [0, 1, 2, 4, 6, 8]) await add(page, tiles.nth(i));
  await linesOf(page).first().locator('[data-step="plus"]').click();
  // A line open on its quick notes.
  await linesOf(page).first().locator("button[aria-expanded]").click();

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
  // The rice picker open on a card.
  await page.locator(ORANGE).first().click();
  await expect(ricePop(page)).toBeVisible();
  expect(await small()).toEqual([]);
  await page.keyboard.press("Escape");
  // With the sheet open, every section expanded.
  await linesOf(page).first().locator('[data-action="edit-line"]').click();
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
  // 2 taps the second result; a rice dish asks, and 2 again takes 白飯.
  await page.keyboard.press("2");
  if (await ricePop(page).isVisible()) await page.keyboard.press("2");
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
