import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E_KITCHEN_PASSWORD } from "./env";
import { enableTestMode } from "./testMode";

/**
 * The POS speed redesign: one tap per dish in the common case.
 *
 *   TOP    sticky rice and size, applied to every tile tap
 *   LEFT   every category on the rail
 *   GRID   the tile body adds at once; the 改 corner opens the sheet
 *   RIGHT  the ticket: tap a line to change it, − / + on the line
 *
 * Every test starts on a fresh tablet (a new context: no stored defaults, so
 * 白飯 and 單點), signed in to the throwaway e2e server.
 */

/** A rice dish sold 單點 and 餐盤 with no other required choice. */
const ORANGE = 'button[data-item]:not([data-asks])[aria-label*="Orange Flavored Chicken"]';
const MONGOLIAN = 'button[data-item]:not([data-asks])[aria-label*="Mongolian Beef"]';
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
  await expect(page.locator('[data-action="print"]')).toBeVisible();
  return page;
}

const ticketOf = (page: Page) => page.getByRole("complementary", { name: "單據" });
const linesOf = (page: Page) => ticketOf(page).locator("[data-line]");
const rice = (page: Page, value: string) => page.locator(`[data-defaults="rice"] button[data-value="${value}"]`);
const size = (page: Page, value: string) => page.locator(`[data-defaults="size"] button[data-value="${value}"]`);

test("one tap adds with the sticky defaults, no sheet", async ({ browser }) => {
  const page = await openPos(browser);
  // A fresh tablet: 白飯 and 單點.
  await expect(rice(page, "steamed")).toHaveAttribute("aria-pressed", "true");
  await expect(size(page, "individual")).toHaveAttribute("aria-pressed", "true");

  await rice(page, "fried").click();
  await page.locator(ORANGE).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(linesOf(page)).toHaveCount(1);
  await expect(linesOf(page).first()).toContainText("炒飯");
  await expect(linesOf(page).first()).toContainText("單點");

  // 餐盤: a tray is the dish alone, so the same tap adds no rice.
  await size(page, "tray").click();
  await page.locator(MONGOLIAN).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(linesOf(page)).toHaveCount(2);
  await expect(linesOf(page).nth(1)).toContainText("餐盤");
  await expect(linesOf(page).nth(1)).not.toContainText("飯 /");

  // Per tablet: the choice survives a reload.
  await page.reload();
  await expect(rice(page, "fried")).toHaveAttribute("aria-pressed", "true");
  await expect(size(page, "tray")).toHaveAttribute("aria-pressed", "true");
  await page.context().close();
});

test("半盤: the half tray is one tap, no rice, priced from the catalogue, and the strip fits at 1024", async ({ browser }) => {
  const page = await openPos(browser);
  // Three sizes on the strip, and the strip still holds every control on one
  // row at 1024: nothing scrolls or clips (the toolbar is overflow-visible, so
  // a too-wide child would have pushed search off the dishes column).
  await expect(page.locator('[data-defaults="size"] button')).toHaveCount(3);
  const fits = await page.locator('[role="toolbar"]').evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits, "the defaults strip fits its column at 1024").toBe(true);
  await expect(page.locator('[role="toolbar"] button[aria-label="搜尋菜名或編號"]')).toBeInViewport({ ratio: 1 });

  await size(page, "half").click();
  await page.locator(MONGOLIAN).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(linesOf(page)).toHaveCount(1);
  await expect(linesOf(page).first()).toContainText("半盤");
  await expect(linesOf(page).first()).not.toContainText("飯 /");
  // Mongolian Beef's handwritten small-tray price.
  await expect(linesOf(page).first()).toContainText("$45.00");

  // The sheet lists all three, half in the middle, and the strip's choice is preselected.
  await page.locator('[data-modify="mongolian-beef-special"]').click();
  const sheet = page.getByRole("dialog");
  const sizeOptions = sheet.locator('[data-section="size"] button[aria-pressed]');
  await expect(sizeOptions).toHaveCount(3);
  await expect(sizeOptions.nth(1)).toContainText("半盤");
  await expect(sizeOptions.nth(1)).toHaveAttribute("aria-pressed", "true");
  await page.context().close();
});

test("changing rice at the top changes the next add, not the lines already on the ticket", async ({ browser }) => {
  const page = await openPos(browser);
  await page.locator(ORANGE).first().click();
  await expect(linesOf(page).first()).toContainText("白飯");

  await rice(page, "fried").click();
  await page.locator(MONGOLIAN).first().click();
  await expect(linesOf(page)).toHaveCount(2);
  await expect(linesOf(page).nth(0)).toContainText("白飯");
  await expect(linesOf(page).nth(0)).not.toContainText("炒飯");
  await expect(linesOf(page).nth(1)).toContainText("炒飯");
  await page.context().close();
});

test("Apply to all changes the rice on every line, and Undo puts it back", async ({ browser }) => {
  const page = await openPos(browser);
  await page.locator(ORANGE).first().click();
  await page.locator(MONGOLIAN).first().click();
  await expect(linesOf(page)).toHaveCount(2);

  await rice(page, "fried").click();
  await page.locator('[data-action="apply-rice-all"]').click();
  for (const i of [0, 1]) await expect(linesOf(page).nth(i)).toContainText("炒飯");
  const toast = page.getByRole("status").filter({ hasText: "已更新 2 項 · Updated 2 lines" });
  await expect(toast).toBeVisible();

  await toast.locator('[data-action="toast-action"]').click();
  for (const i of [0, 1]) {
    await expect(linesOf(page).nth(i)).toContainText("白飯");
    await expect(linesOf(page).nth(i)).not.toContainText("炒飯");
  }
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

  // Only the beef-or-chicken section is open; the rice is the strip's 白飯.
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

test("tapping a tile twice bumps its line's quantity", async ({ browser }) => {
  const page = await openPos(browser);
  await page.locator(ORANGE).first().click();
  await page.locator(ORANGE).first().click();
  await expect(linesOf(page)).toHaveCount(1);
  await expect(linesOf(page).first().locator("[data-qty]")).toHaveText("2");

  // A different default is a different line, not a bump.
  await rice(page, "fried").click();
  await page.locator(ORANGE).first().click();
  await expect(linesOf(page)).toHaveCount(2);
  await page.context().close();
});

test("minus at 1 removes the line with no confirm, and Undo restores it", async ({ browser }) => {
  const page = await openPos(browser);
  await page.locator(ORANGE).first().click();
  await page.locator(MONGOLIAN).first().click();
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
  await page.locator(ORANGE).first().click();
  await page.locator(MONGOLIAN).first().click();
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
    for (const i of [0, 1, 2, 4, 6, 8]) await tiles.nth(i).click();
    await rice(page, "none").click();
    await page.locator('[data-action="apply-rice-all"]').click();
    await linesOf(page).first().locator("button[aria-haspopup]").click();
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
  for (const i of [0, 1, 2, 4, 6, 8]) await tiles.nth(i).click();
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
