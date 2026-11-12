import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_DB_PORT, E2E_KITCHEN_PASSWORD } from "./env";
import { enableTestMode } from "./testMode";

/**
 * Single-key shortcuts (J K A C P X, 1 2 3, ?, and the shell's N B H M) must
 * do NOTHING while staff are typing or a dialog is open. Typing "a" into a
 * search box must never accept the selected order, and "x" must never start a
 * cancel.
 *
 * The POS has no typed quantity field: quantity is a − / + stepper. So the POS
 * half types into the two text fields a cashier actually types in on that
 * screen, the dish search and the ticket line's note (which sits beside the
 * stepper), and checks the quantity did not move.
 */

const TENANT = "new-mandarin-canton";
let page: Page;
let db: Client;
let target: { id: number; number: string };

async function seedQueued(): Promise<{ id: number; number: string }> {
  const number = `A-${600 + Math.floor(Math.random() * 300)}`;
  const { rows } = await db.query(
    `insert into orders (tenant_id, order_number, business_date, status, idempotency_key, items, totals,
                         customer, phone_verified_at, pickup_at, channel, print_station)
     values ($1, $2, (now() at time zone 'America/Los_Angeles')::date, 'QUEUED', $3,
             '[]', '{"subtotalCents":0,"taxCents":0,"tipCents":0,"totalCents":0}',
             '{"name":"Shortcut Target","phone":"+16195550166"}', now(), now() + interval '20 minutes',
             'web', 'online')
     returning id`,
    [TENANT, number, `e2e-shortcuts-${Date.now()}`],
  );
  return { id: Number(rows[0].id), number };
}

const statusOf = async (id: number) =>
  String((await db.query(`select status from orders where id = $1`, [id])).rows[0].status);

const anyDialog = () => page.locator('dialog[open], [role="dialog"]');

/** Press every shortcut key, one at a time, the way a typist would. */
async function typeEveryShortcut(): Promise<void> {
  for (const key of ["a", "x", "j", "k", "c", "p", "1", "2", "3", "n", "b", "h", "m"]) {
    await page.keyboard.press(key);
  }
  await page.keyboard.press("Shift+Slash"); // "?"
}

test.beforeAll(async ({ browser }) => {
  db = new Client({ host: "localhost", port: E2E_DB_PORT, user: "postgres", password: "postgres", database: "nmc_e2e" });
  await db.connect();
  target = await seedQueued();

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Sound already answered on this device, so its prompt is not in the way.
  await context.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
  page = await context.newPage();
  await enableTestMode(page);
  await page.goto("/kitchen");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  await expect(page.getByRole("heading", { name: target.number })).toBeVisible();
});

test.afterAll(async () => {
  await db.query(`delete from orders where id = $1`, [target.id]);
  await page.context().close();
  await db.end();
});

test("board: typing a and x in the search box accepts and cancels nothing", async () => {
  // Select the target order with the keyboard, as a counter laptop would.
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: target.number }) });
  await card.locator("h3").click();
  await expect(card).toHaveClass(/ring-3/);

  const search = page.getByRole("searchbox");
  await search.click();
  await page.keyboard.type("a");
  await page.keyboard.type("x");
  await expect(search).toHaveValue("ax");
  await typeEveryShortcut();

  await expect(anyDialog()).toHaveCount(0); // no cancel, no reprint, no help
  expect(await statusOf(target.id)).toBe("QUEUED"); // not accepted, not cancelled
  await expect(page).toHaveURL(/\/kitchen(\?|$)/); // N / B / H navigated nowhere
  expect(new URL(page.url()).searchParams.get("station")).toBeNull(); // 1 2 3 filtered nothing
  await expect(page.getByRole("status").filter({ hasText: target.number })).toHaveCount(0); // no action toast

  // Control: out of the field, the same key does act. Otherwise this test
  // would pass on a board whose shortcuts were simply broken.
  await search.press("Escape");
  await search.fill("");
  await card.locator("h3").click();
  await page.keyboard.press("x");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("a"); // inside the open cancel dialog: nothing
  expect(await statusOf(target.id)).toBe("QUEUED");
  await page.keyboard.press("Escape");
  await expect(anyDialog()).toHaveCount(0);
});

test("POS: typing a and x in the dish search and the line note fires nothing", async () => {
  await page.goto("/kitchen/pos");
  await expect(page.locator('[data-value="takeout"]')).toBeVisible();

  // The dish search.
  await page.getByRole("button", { name: "搜尋菜名或編號" }).click();
  const search = page.getByRole("textbox", { name: "搜尋菜名或編號" });
  await expect(search).toBeFocused();
  await page.keyboard.type("ax");
  await expect(search).toHaveValue("ax");
  await typeEveryShortcut();
  await expect(page).toHaveURL(/\/kitchen\/pos$/);
  await expect(anyDialog()).toHaveCount(0);
  await page.getByRole("button", { name: "收起搜尋" }).click();

  // Put a dish on the ticket, open its line, and type a note beside the stepper.
  await page.locator("button[data-item]:not([disabled])").first().click();
  const sheetAdd = page.getByRole("button", { name: /加入單據/ });
  if (await sheetAdd.isVisible().catch(() => false)) await sheetAdd.click();
  const ticket = page.getByRole("complementary", { name: "單據" });
  const line = ticket.locator("[aria-expanded]").first();
  if ((await line.getAttribute("aria-expanded")) !== "true") await line.click();
  await ticket.getByRole("button", { name: "備註 Note" }).click();
  const note = ticket.getByRole("textbox", { name: "備註 Note" });
  const qty = async () => (await ticket.locator("[aria-expanded]").first().textContent())?.match(/^\d+/)?.[0];
  const qtyBefore = await qty();
  await note.click();
  await page.keyboard.type("ax");
  await expect(note).toHaveValue("ax");
  await typeEveryShortcut();
  await expect(page).toHaveURL(/\/kitchen\/pos$/);
  await expect(anyDialog()).toHaveCount(0);
  expect(await qty()).toBe(qtyBefore); // the stepper did not move
});

test("POS: an open item sheet (an ARIA dialog) owns the keyboard", async () => {
  await page.goto("/kitchen/pos");
  // A family dinner has more than two sizes, so its tile opens the sheet
  // (role="dialog") rather than going straight onto the ticket.
  await page.getByRole("button", { name: "搜尋菜名或編號" }).click();
  await page.getByRole("textbox", { name: "搜尋菜名或編號" }).fill("family");
  await page.locator('button[data-item^="combo-family-dinner"]').first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // Focus on the sheet itself, not a field in it: only the dialog rule applies.
  await page.getByRole("dialog").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("b");
  await page.keyboard.press("h");
  await page.keyboard.press("Shift+Slash");
  await expect(page).toHaveURL(/\/kitchen\/pos$/);
  await expect(page.getByRole("dialog", { name: "快捷鍵" })).toHaveCount(0);
});
