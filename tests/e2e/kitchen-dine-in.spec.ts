import { expect, test, type Page } from "@playwright/test";
import { E2E_KITCHEN_PASSWORD } from "./env";
import { enableTestMode } from "./testMode";
import { chooseRequired } from "./posSheet";

/**
 * The staff POS, driven like a person at the counter: takeout by phone, and
 * the dine-in floor plan (seat, combine, add items, clear).
 *
 * Runs against scripts/e2e-server.ts, a production build on a throwaway
 * database, so these orders go nowhere. Serial, in order: each step reads the
 * room the last one left (see playwright.config.ts).
 *
 * Set E2E_SHOTS=<dir> to save the screenshots the PR shows.
 */

test.describe.configure({ mode: "serial" });

const SHOTS = process.env.E2E_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  // Off every control, past every colour transition: the resting state.
  await page.mouse.move(1, 1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const PREVIEW_HOST = "feat-dine-in-pos-nmc-web.example.workers.dev";

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
  // Test mode: pickup times as if the store were open, whatever the clock.
  await enableTestMode(page);
  await page.goto("/kitchen/pos");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  await expect(page.locator('[data-value="dine_in"]')).toBeVisible();
});

test.afterAll(async () => {
  await page.close();
});

const ticket = () => page.getByRole("complementary", { name: "單據" });

/** Add the first orderable dish: one tap, or through its sheet when it has a choice to make. */
async function addDish() {
  const before = await ticket().locator("[aria-expanded]").count();
  await page.locator("button[data-item]:not([disabled])").first().click();
  const sheetAdd = page.getByRole("button", { name: /加入單據/ });
  if (await sheetAdd.isVisible().catch(() => false)) {
    await chooseRequired(page);
    await sheetAdd.click();
  }
  await expect(sheetAdd).toHaveCount(0);
  await expect.poll(() => ticket().locator("[aria-expanded]").count()).toBeGreaterThanOrEqual(Math.max(1, before));
}

async function print(): Promise<string> {
  await page.locator('[data-action="print"]').click();
  const placed = page.getByRole("status").filter({ hasText: /A-\d{3}/ });
  await expect(placed).toBeVisible();
  return (await placed.textContent())!.match(/A-\d{3}/)![0];
}

/** The floor plan: 堂食's home with no table, or 換桌 from a ticket that has one. */
async function openFloor() {
  const change = page.locator("[data-seating]");
  if (await change.isVisible().catch(() => false)) await change.click();
  await expect(table("9")).toBeVisible();
}

const table = (label: string) => page.locator(`[data-table="${label}"]`);

test("takeout phone order", async () => {
  await expect(page.locator('[data-value="takeout"]')).toHaveAttribute("aria-pressed", "true");
  await addDish();
  // The customer fields live in the sheet behind the context chip.
  await page.locator('[data-context="takeout"]').click();
  await page.locator('[data-channel="phone"]').click();
  await page.getByLabel("客人姓名").fill("E2E Phone Test");
  await page.getByLabel("電話", { exact: true }).fill("6195550188");
  await page.locator('[data-action="details-done"]').click();
  await shot(page, "pos-takeout");
  const number = await print();
  expect(number).toMatch(/^A-\d{3}$/);
});

test("seat a table", async () => {
  await page.locator('[data-value="dine_in"]').click();
  // Dine-in without a table is the floor plan.
  await expect(table("1")).toHaveAttribute("data-state", "free");
  await table("1").click();
  await page.locator('[data-guests="3"]').click();
  await expect(ticket()).toContainText("桌 1 · 3 位");
  await addDish();
  await shot(page, "pos-dine-in");
  await print();

  // Printed: the table is seated and the floor plan is back.
  await openFloor();
  await expect(table("1")).toHaveAttribute("data-state", "seated");
  await expect(table("1")).toHaveAttribute("aria-label", /3 位/);
});

test("combine 4+5", async () => {
  await openFloor();
  await page.locator('[data-combine="4+5"]').click();
  await page.locator('[data-guests="9"]').click();
  await expect(ticket()).toContainText("桌 4+5 · 9 位");
  await addDish();
  await print();

  await openFloor();
  // One merged shape; neither half is drawn on its own.
  await expect(table("4+5")).toHaveAttribute("data-state", "seated");
  await expect(table("4")).toHaveCount(0);
  await expect(table("5")).toHaveCount(0);
  await shot(page, "floor-plan-mixed");
});

test("add items to an occupied table", async () => {
  await openFloor();
  await table("1").click();
  // A seated table never offers a new party: only 加菜 or 清台.
  await expect(page.locator("[data-guests]")).toHaveCount(0);
  await page.getByRole("button", { name: /加菜/ }).click();
  await expect(ticket()).toContainText("加菜");
  await addDish();
  await print();

  const res = await page.request.get("/api/kitchen/tables");
  const body = (await res.json()) as { tables: { tableLabel: string; orderCount: number; guestCount: number }[] };
  const one = body.tables.find((t) => t.tableLabel === "1");
  expect(one?.orderCount).toBe(2);
  expect(one?.guestCount).toBe(3);
});

test("clear a table", async () => {
  await openFloor();
  await table("1").click();
  await page.getByRole("button", { name: /^清台/ }).click();
  // Confirm step first: nothing is cleared yet.
  await expect(table("1")).toHaveAttribute("data-state", "seated");
  // The shared confirm dialog, the same one the board's Clear table opens.
  await page.getByRole("dialog").getByRole("button", { name: /確認清台/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "已清台" })).toBeVisible();
  await expect(table("1")).toHaveAttribute("data-state", "free");
  await expect(table("4+5")).toHaveAttribute("data-state", "seated");
});

test("preview host: every staff write is 403", async () => {
  const headers = { host: PREVIEW_HOST, "content-type": "application/json" };
  const order = await page.request.post("/api/kitchen/orders", {
    headers,
    data: { lines: [], channel: "dine_in", table: { label: "9", guests: 2 }, idempotencyKey: "e2e-preview-0001" },
  });
  expect(order.status()).toBe(403);
  expect(((await order.json()) as { reason: string }).reason).toBe("preview_host");
  const clear = await page.request.post("/api/kitchen/tables", { headers, data: { action: "clear", label: "4+5" } });
  expect(clear.status()).toBe(403);
  const action = await page.request.post("/api/kitchen/orders/1", { headers, data: { action: "reprint" } });
  expect(action.status()).toBe(403);

  // And nothing moved: 4+5 is still seated.
  const res = await page.request.get("/api/kitchen/tables");
  const body = (await res.json()) as { tables: { tableLabel: string }[] };
  expect(body.tables.map((t) => t.tableLabel)).toContain("4+5");
});

test("board and history show the table", async () => {
  await page.goto("/kitchen");
  await expect(page.getByText("4+5 號桌").first()).toBeVisible();
  await shot(page, "board");

  await page.goto("/kitchen/history");
  await page.getByRole("group", { name: "服務" }).getByRole("button", { name: "堂食" }).click();
  await expect(page.getByText("4+5 號桌").first()).toBeVisible();
  // Only dine-in rows: the takeout phone order is filtered out.
  await expect(page.getByText("E2E Phone Test")).toHaveCount(0);
  await shot(page, "history-dine-in");
});

test("readability: type floor, 大字, columns", async () => {
  await page.goto("/kitchen/pos");
  const rootPx = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  expect(await rootPx()).toBe(22);

  // Every visible text node is at least the spec's smallest step: 15px, the
  // English under a 22px Chinese name (docs/kitchen-design.md).
  const smallest = await page.evaluate(() => {
    let min = Infinity;
    const walker = document.createTreeWalker(document.querySelector("[data-kitchen-surface]")!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.textContent?.trim() || el.offsetParent === null) continue;
      min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
    }
    return min;
  });
  expect(smallest).toBeGreaterThanOrEqual(15);

  // The print button is the primary action: 80px or taller.
  const printBox = await page.locator('[data-action="print"]').boundingBox();
  expect(printBox!.height).toBeGreaterThanOrEqual(80);

  const columns = () =>
    page.evaluate(() => getComputedStyle(document.querySelector("section[id^='pos-cat-'] > div")!).gridTemplateColumns.split(" ").length);
  // 11" landscape: two columns of name tiles (three at 13").
  expect(await columns()).toBe(2);

  const largeText = async () => {
    await page.getByRole("button", { name: "更多" }).click();
    await page.getByRole("menuitemcheckbox", { name: /大字/ }).click();
  };
  await largeText();
  await expect.poll(rootPx).toBe(27.5);
  await shot(page, "pos-large-text");
  await page.reload();
  // Saved per device.
  await expect.poll(rootPx).toBe(27.5);
  await largeText();
  await expect.poll(rootPx).toBe(22);

  await page.setViewportSize({ width: 820, height: 1180 });
  expect(await columns()).toBe(2);
  await shot(page, "pos-portrait");
  await page.setViewportSize({ width: 1180, height: 820 });
});
