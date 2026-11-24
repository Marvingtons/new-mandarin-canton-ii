import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E_KITCHEN_PASSWORD } from "./env";
import { enableTestMode } from "./testMode";

/**
 * 改單 EDIT ORDER in the browser (docs/edit-order.md), on the counter tablet
 * (Chrome) and the iPad (WebKit):
 *
 *   - Edit on the card opens the POS on the order; adding a line saves a
 *     change ticket with one + block, removing one a - block, changing a
 *     tray 餐盤 -> 半盤 a 改 block
 *   - an identical ticket cannot be saved ("no changes")
 *   - a double tap on Save is one edit and one change ticket
 *   - an order that never reached a printer is replaced, not changed
 *   - a second tablet saving a stale copy gets the lock error and Reopen
 *   - the edit header and the confirm sheet keep the layout rules (nothing
 *     sideways, every target 44px, the sheet's buttons on screen) at all four
 *     viewports
 *
 * The printer is played by the specs themselves (poll, fetch, confirm on the
 * CloudPRNT route with the e2e server's test secret and store printer MAC),
 * because a change ticket only exists for an order the kitchen has paper for.
 */

const PRINT = "/api/print/e2e-print-secret-not-a-printer";
const STORE_MAC = "00:11:62:00:00:0B";

const LANDSCAPE = { width: 1024, height: 768 };
const PORTRAIT = { width: 768, height: 1024 };
const VIEWPORTS = [LANDSCAPE, PORTRAIT, { width: 1180, height: 820 }, { width: 820, height: 1180 }];

/**
 * As kitchen-sound.spec.ts: `next start` issues Secure cookies, which WebKit
 * refuses on this HTTP localhost harness, so on the iPad project the cookie
 * the server actually issued is re-set without Secure, in the test browser
 * only. Path "/", so it reaches /api/** as well.
 */
async function keepCookie(page: Page, response: Promise<import("@playwright/test").Response>, name: string): Promise<void> {
  const value = (await (await response).headerValue("set-cookie"))?.match(new RegExp(`${name}=([^;]+)`))?.[1];
  expect(value, name).toBeTruthy();
  await page.context().addCookies([{ name, value: value!, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax", secure: false }]);
}

async function signIn(browser: Browser, viewport?: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext(viewport ? { viewport } : {});
  await context.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
  const page = await context.newPage();
  const webkit = browser.browserType().name() === "webkit";
  const posted = (path: string) =>
    page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.startsWith(path));

  const testMode = webkit ? posted("/api/test-mode") : null;
  await enableTestMode(page);
  if (testMode) await keepCookie(page, testMode, "nmc_test_mode");

  await page.goto("/kitchen/pos");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  const login = webkit ? posted("/kitchen") : null;
  await page.locator('input[type="password"]').press("Enter");
  if (login) {
    await keepCookie(page, login, "nmc_kitchen");
    await page.reload();
  }
  await expect(page.locator('[data-action="print"], [data-action="bar-print"]').first()).toBeAttached();
  // A touch iPad is asked once whether to turn sound on: answer it, as staff would.
  const notNow = page.getByRole("button", { name: "暫時不用" });
  // (It can re-render as the page settles, so a missed tap is not a failure:
  // each flow below navigates and asserts on what it needs.)
  if (await notNow.isVisible()) await notNow.click({ timeout: 3000 }).catch(() => {});
  return page;
}

interface Line {
  itemId: string;
  sizeId: string;
  modifierIds: string[];
  quantity: number;
}
const BEEF: Line = { itemId: "mongolian-beef-special", sizeId: "individual", modifierIds: ["rice-steamed"], quantity: 2 };
const TRAY: Line = { itemId: "mandarin-special", sizeId: "party-tray", modifierIds: [], quantity: 1 };

/** A phone order through the real POS route. */
async function placeOrder(page: Page, lines: Line[] = [BEEF, TRAY]): Promise<{ id: number; orderNumber: string }> {
  const body = await page.evaluate(async (lines) => {
    const res = await fetch("/api/kitchen/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "phone",
        customer: { phone: "6195550123" },
        pickup: { time: "asap" },
        idempotencyKey: `edit-spec-${Date.now()}-${Math.random()}`,
        lines,
      }),
    });
    return res.json();
  }, lines);
  expect(body.ok, JSON.stringify(body)).toBe(true);
  return body.order;
}

/**
 * Be the store printer until its queue is empty: poll, fetch, confirm.
 * Other specs' store orders still waiting are printed on the way. Returns how
 * many jobs it printed.
 */
async function printQueue(page: Page): Promise<number> {
  return page.evaluate(
    async ({ PRINT, STORE_MAC }) => {
      let printed = 0;
      for (let i = 0; i < 40; i++) {
        const poll = await (
          await fetch(PRINT, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ statusCode: "200 OK", printerMAC: STORE_MAC }),
          })
        ).json();
        if (!poll.jobReady) break;
        const token = encodeURIComponent(poll.jobToken);
        await (await fetch(`${PRINT}?token=${token}&mac=${encodeURIComponent(STORE_MAC)}&type=application/vnd.star.starprnt`)).arrayBuffer();
        await fetch(`${PRINT}?token=${token}&mac=${encodeURIComponent(STORE_MAC)}&code=OK`, { method: "DELETE" });
        printed++;
      }
      return printed;
    },
    { PRINT, STORE_MAC },
  );
}

async function revisions(page: Page, id: number) {
  return page.evaluate(async (id) => (await fetch(`/api/kitchen/orders/${id}/revisions`, { cache: "no-store" })).json(), id) as Promise<{
    revision: number;
    edits: { revision: number }[];
    changeTickets: { id: string; printedAt: string | null }[];
  }>;
}

async function changeTicketText(page: Page, id: number, changeId: string): Promise<string[]> {
  const body = await page.evaluate(
    async ([id, changeId]) => (await fetch(`/api/kitchen/orders/${id}/ticket?change=${changeId}&copy=kitchen&format=text`, { cache: "no-store" })).json(),
    [id, changeId] as const,
  );
  return body.lines as string[];
}

/** The board's card for this order, then its Edit, into the POS. */
async function openEdit(page: Page, id: number): Promise<void> {
  await page.goto("/kitchen");
  const card = page.locator(`article[data-order-id="${id}"]`);
  await expect(card).toBeVisible();
  await card.locator('[data-action="edit-order"]').click();
  await expect(page).toHaveURL(new RegExp(`/kitchen/pos\\?edit=${id}$`));
  await expect(page.locator("[data-edit-head]").first()).toBeAttached();
}

/** The ticket panel: in portrait it is a sheet behind the bar. */
async function showTicket(page: Page): Promise<void> {
  const open = page.locator('[data-action="open-ticket"]');
  if (await open.isVisible()) await open.click();
  await expect(page.locator("[data-ticket]")).toBeVisible();
}

async function tapDish(page: Page, itemId: string, portion = "individual"): Promise<void> {
  const tile = page.locator(`button[data-item="${itemId}"]:visible`).first();
  const portions = await tile.getAttribute("data-portions");
  await tile.click();
  if (portions !== null) await page.locator(`[data-sheet="portion"] [data-portion="${portion}"]`).click();
}

const save = (page: Page) => page.locator('[data-ticket] [data-action="print"]');
const sheet = (page: Page) => page.locator('[data-sheet="edit-confirm"]');

/* ------------------------------------------------------------- flows -- */

test("Edit on the card, add a dish: one change ticket with one + block", async ({ browser }) => {
  const page = await signIn(browser);
  const order = await placeOrder(page);
  await printQueue(page);

  await openEdit(page, order.id);
  await showTicket(page);
  await expect(page.locator("[data-edit-head]")).toContainText(`改單 ${order.orderNumber}`);
  await expect(page.locator('[data-action="cancel-edit"]')).toBeVisible();
  await expect(page.locator("[data-ticket] [data-line]")).toHaveCount(2);
  await expect(save(page)).toBeDisabled();
  await expect(save(page)).toContainText("沒有更改");

  await tapDish(page, "egg-rolls");
  await showTicket(page);
  await expect(page.locator("[data-ticket] [data-edit-tag]")).toHaveText(["+ 新"]);
  await expect(save(page)).toBeEnabled();
  await save(page).click();

  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).locator('[data-block="added"] li')).toHaveCount(1);
  await expect(sheet(page).locator('[data-block="removed"]')).toHaveCount(0);
  await expect(sheet(page)).toContainText("春卷");
  await sheet(page).locator('[data-action="confirm-edit"]').click();
  await expect(page).toHaveURL(/\/kitchen$/);

  const rev = await revisions(page, order.id);
  expect(rev.revision).toBe(1);
  expect(rev.changeTickets).toHaveLength(1);
  const text = await changeTicketText(page, order.id, rev.changeTickets[0].id);
  expect(text).toContain(`改單 CHANGE · ${order.orderNumber}`);
  expect(text).toContain("+ 加 ADDED");
  expect(text).not.toContain("- 減 REMOVED");
  expect(text).not.toContain("改 CHANGED");

  // The card counts it, and the printer gets it.
  await expect(page.locator(`article[data-order-id="${order.id}"] [data-change-count="1"]`)).toBeVisible();
  expect(await printQueue(page)).toBeGreaterThanOrEqual(1);
  expect((await revisions(page, order.id)).changeTickets[0].printedAt).not.toBeNull();

  // History: the row says 已改 ×1, and opening it shows the revision's diff.
  await page.goto("/kitchen/history");
  const row = page.locator("li > button[aria-expanded]", { hasText: order.orderNumber }).first();
  await expect(row.locator('[data-history-edited="1"]')).toBeVisible();
  await row.click();
  const past = page.locator(`article[data-order-id="${order.id}"]`);
  await past.locator('[data-action="toggle-revisions"]').click();
  await expect(past.locator('[data-revision-entry="1"] [data-block="added"]')).toContainText("春卷");

  // 重印 offers the change ticket too; choosing it queues exactly one job.
  await page.goto("/kitchen");
  await page.locator(`article[data-order-id="${order.id}"]`).getByRole("button", { name: /重印/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("[data-reprint-what]").getByText("改單 第1次").click();
  await dialog.locator('button[type="submit"]').click();
  await expect(page.locator(`article[data-order-id="${order.id}"]`)).toContainText("已重印 ×1");
  expect(await printQueue(page)).toBe(1);
  await page.context().close();
});

test("remove a dish: a - block; a tray 餐盤 -> 半盤: a 改 block", async ({ browser }) => {
  const page = await signIn(browser);
  const order = await placeOrder(page, [{ ...BEEF, quantity: 1 }, TRAY]);
  await printQueue(page);

  await openEdit(page, order.id);
  await showTicket(page);
  // Minus at quantity 1 takes the line off.
  await page.locator("[data-ticket] [data-line]").first().locator('[data-step="minus"]').click();
  await expect(page.locator("[data-ticket] [data-line]")).toHaveCount(1);
  await save(page).click();
  await expect(sheet(page).locator('[data-block="removed"] li')).toHaveCount(1);
  await sheet(page).locator('[data-action="confirm-edit"]').click();
  await expect(page).toHaveURL(/\/kitchen$/);
  let rev = await revisions(page, order.id);
  expect(await changeTicketText(page, order.id, rev.changeTickets[0].id)).toContain("- 減 REMOVED");
  await printQueue(page);

  await openEdit(page, order.id);
  await showTicket(page);
  await page.locator("[data-ticket] [data-line] button[aria-haspopup]").first().click();
  const itemSheet = page.locator('[role="dialog"]').filter({ has: page.locator('[data-action="sheet-add"]') });
  const sizeHead = itemSheet.locator('[data-section="size"] legend button[aria-expanded="false"]');
  if (await sizeHead.count()) await sizeHead.click();
  await itemSheet.locator('[data-section="size"] button[aria-pressed]', { hasText: "Half Tray" }).click();
  await itemSheet.locator('[data-action="sheet-add"]').click();
  await expect(page.locator("[data-ticket] [data-edit-tag]")).toHaveText(["改"]);
  await save(page).click();
  await expect(sheet(page).locator('[data-block="changed"]')).toContainText("餐盤 → 半盤");
  await sheet(page).locator('[data-action="confirm-edit"]').click();
  await expect(page).toHaveURL(/\/kitchen$/);
  rev = await revisions(page, order.id);
  const text = await changeTicketText(page, order.id, rev.changeTickets[0].id);
  expect(text).toContain("改 CHANGED");
  expect(text).toContain("餐盤 → 半盤");
  await page.context().close();
});

test("a double tap on Save is one edit and one change ticket", async ({ browser }) => {
  const page = await signIn(browser);
  const order = await placeOrder(page);
  await printQueue(page);
  await openEdit(page, order.id);
  await tapDish(page, "egg-rolls");
  await showTicket(page);
  await save(page).click();
  const confirm = sheet(page).locator('[data-action="confirm-edit"]');
  await expect(confirm).toBeEnabled();
  await confirm.dblclick();
  await expect(page).toHaveURL(/\/kitchen$/);
  const rev = await revisions(page, order.id);
  expect(rev.revision).toBe(1);
  expect(rev.edits).toHaveLength(1);
  expect(rev.changeTickets).toHaveLength(1);
  // One print job for it.
  expect(await printQueue(page)).toBe(1);
  await page.context().close();
});

test("an order that never reached a printer is replaced, with no change ticket", async ({ browser }) => {
  const page = await signIn(browser);
  const order = await placeOrder(page);
  await openEdit(page, order.id);
  await tapDish(page, "egg-rolls");
  await showTicket(page);
  await save(page).click();
  await expect(sheet(page)).toContainText("此單還未列印");
  await sheet(page).locator('[data-action="confirm-edit"]').click();
  await expect(page).toHaveURL(/\/kitchen$/);
  const rev = await revisions(page, order.id);
  expect(rev.revision).toBe(1);
  expect(rev.changeTickets).toHaveLength(0);
  const receipt = await page.evaluate(
    async (id) => (await fetch(`/api/kitchen/orders/${id}/ticket?copy=kitchen&format=text`, { cache: "no-store" })).json(),
    order.id,
  );
  expect((receipt.lines as string[]).some((l) => l.includes("Egg Rolls"))).toBe(true);
  await page.context().close();
});

test("a second tablet saving the same order gets the lock error and Reopen", async ({ browser }) => {
  const first = await signIn(browser);
  const second = await signIn(browser);
  const order = await placeOrder(first);
  await printQueue(first);
  await openEdit(first, order.id);
  await openEdit(second, order.id);

  await tapDish(first, "egg-rolls");
  await showTicket(first);
  await save(first).click();
  await sheet(first).locator('[data-action="confirm-edit"]').click();
  await expect(first).toHaveURL(/\/kitchen$/);

  await tapDish(second, "egg-rolls");
  await showTicket(second);
  await save(second).click();
  await expect(sheet(second)).toContainText("此單已在另一部平板修改");
  await expect(sheet(second).locator('[data-action="reopen-edit"]')).toBeVisible();
  await sheet(second).locator('[data-action="reopen-edit"]').click();
  await showTicket(second);
  await expect(second.locator("[data-ticket] [data-line]")).toHaveCount(3);
  expect((await revisions(first, order.id)).revision).toBe(1);
  await first.context().close();
  await second.context().close();
});

test("the E key opens Edit on the selected card, and the Shortcuts sheet lists it", async ({ browser }) => {
  const page = await signIn(browser);
  const order = await placeOrder(page);
  await page.goto("/kitchen");
  const card = page.locator(`article[data-order-id="${order.id}"]`);
  await card.locator("h3").click();
  await page.keyboard.press("e");
  await expect(page).toHaveURL(new RegExp(`/kitchen/pos\\?edit=${order.id}$`));
  await page.goto("/kitchen");
  await page.locator(`article[data-order-id="${order.id}"] h3`).click();
  await page.keyboard.press("Shift+Slash"); // "?"
  await expect(page.getByRole("dialog", { name: "快捷鍵" })).toContainText("改單");
  await page.context().close();
});

/* ------------------------------------------------------------ layout -- */

for (const viewport of VIEWPORTS) {
  test(`edit header and confirm sheet at ${viewport.width}x${viewport.height}: nothing sideways, 44px targets, buttons on screen`, async ({ browser }) => {
    const page = await signIn(browser, viewport);
    const order = await placeOrder(page);
    await printQueue(page);
    await openEdit(page, order.id);
    await tapDish(page, "egg-rolls");
    await showTicket(page);
    await expect(page.locator("[data-edit-head]")).toBeInViewport({ ratio: 1 });
    await expect(page.locator('[data-action="cancel-edit"]')).toBeInViewport({ ratio: 1 });
    await expect(save(page)).toBeInViewport({ ratio: 1 });

    const sideways = () => page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
    const smallTargets = () =>
      page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>(
          ":is([data-kitchen-surface], dialog[open]) :is(button, input, select, textarea, a[href])",
        )) {
          if (el.closest('[aria-hidden="true"]') || el.tabIndex < 0) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
          if (r.width < 43.5 || r.height < 43.5) {
            out.push(`${el.tagName} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        }
        return out;
      });
    expect(await sideways()).toBe(0);
    expect(await smallTargets()).toEqual([]);

    await save(page).click();
    await expect(sheet(page).locator('[data-block="added"]')).toBeVisible();
    await expect(sheet(page).locator('[data-action="confirm-edit"]')).toBeInViewport({ ratio: 1 });
    await expect(sheet(page).getByRole("button", { name: "返回修改" })).toBeInViewport({ ratio: 1 });
    await expect(sheet(page).locator("[data-edit-total]")).toBeInViewport({ ratio: 1 });
    expect(await sideways()).toBe(0);
    expect(await smallTargets()).toEqual([]);
    await page.context().close();
  });
}
