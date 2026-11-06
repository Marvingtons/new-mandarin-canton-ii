import { expect, test, type Page } from "@playwright/test";
import { E2E_KITCHEN_PASSWORD, E2E_OWNER_PIN, E2E_PRINT_SECRET } from "./env";

/**
 * Adding the second printer, driven like the owner at the counter tablet:
 * a new printer polls, the board says one is waiting, the owner assigns it as
 * the POS printer with the PIN and points phone orders at it, and the board
 * then shows both.
 *
 * The two printers are simulated by POSTing CloudPRNT polls to the e2e
 * server's print endpoint, exactly as the hardware would. Failover timing
 * (60s of silence) is covered by `npm run verify:printers`, not here.
 *
 * Set E2E_SHOTS=<dir> to save the screenshots the PR shows.
 */

test.describe.configure({ mode: "serial" });

const SHOTS = process.env.E2E_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.mouse.move(1, 1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const MAC_A = "00:11:62:e2:e0:0a";
const MAC_B = "00:11:62:e2:e0:0b";

let page: Page;

async function poll(mac: string): Promise<void> {
  const res = await page.request.post(`/api/print/${E2E_PRINT_SECRET}`, {
    data: { statusCode: "200 OK", printerMAC: mac },
  });
  expect(res.ok()).toBe(true);
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
  await page.goto("/kitchen");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  await expect(page.locator("main h1")).toBeVisible();
});

test.afterAll(async () => {
  await page.close();
});

test("a second printer polling shows up as waiting to be set up", async () => {
  await poll(MAC_A); // first printer: bootstraps as the takeout printer
  await poll(MAC_B); // unknown: stored, given nothing
  await page.goto("/kitchen");
  await expect(page.locator('[data-printer-chip="takeout"]')).toBeVisible();
  await expect(page.locator("[data-unassigned-printers]")).toBeVisible();
  await shot(page, "printers-1-board-new-printer");
});

test("assigning it needs the owner PIN", async () => {
  await page.locator("[data-unassigned-printers]").click();
  await expect(page).toHaveURL(/\/kitchen\/printers$/);
  const b = page.locator(`[data-printer="${MAC_B}"]`);
  await expect(b).toHaveAttribute("data-role", "none");

  // No PIN: refused in the page.
  await b.locator('[data-assign="pos"]').click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(b).toHaveAttribute("data-role", "none");

  // Wrong PIN: refused by the server.
  await page.locator("[data-owner-pin]").fill("0000");
  await b.locator('[data-assign="pos"]').click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(b).toHaveAttribute("data-role", "none");

  // The owner's PIN.
  await page.locator("[data-owner-pin]").fill(E2E_OWNER_PIN);
  await b.locator('[data-assign="pos"]').click();
  await expect(page.locator(`[data-printer="${MAC_B}"]`)).toHaveAttribute("data-role", "pos");
  await expect(page.locator(`[data-printer="${MAC_B}"]`)).toHaveAttribute("data-active", "true");
});

test("phone orders can be pointed at the POS printer", async () => {
  await page.locator('[data-route="phone"]').selectOption("pos");
  await page.reload();
  await expect(page.locator('[data-route="phone"]')).toHaveValue("pos");
  await shot(page, "printers-2-page");
});

test("the board then shows both printers by name", async () => {
  await poll(MAC_A);
  await poll(MAC_B);
  await page.goto("/kitchen");
  await expect(page.locator('[data-printer-chip="takeout"]')).toBeVisible();
  await expect(page.locator('[data-printer-chip="pos"]')).toBeVisible();
  await expect(page.locator("[data-unassigned-printers]")).toHaveCount(0);
  await shot(page, "printers-3-board-two-printers");
});
