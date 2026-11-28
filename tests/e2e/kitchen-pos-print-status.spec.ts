import { expect, test, type Page } from "@playwright/test";
import { E2E_KITCHEN_PASSWORD } from "./env";
import { enableTestMode } from "./testMode";
import { chooseRequired, tapDish } from "./posSheet";

/**
 * The POS print status line follows the ticket to paper, from the board poll:
 *
 *   已送出   printed on the POS, the printer has not polled yet
 *   列印中   the printer was handed it and has not confirmed
 *   已列印   the printer confirmed; the count stops at the server's own time
 *
 * The printer is played by the spec on the CloudPRNT route (the e2e server's
 * test secret and store printer MAC), as in kitchen-edit-order.spec.ts.
 */

const PRINT = "/api/print/e2e-print-secret-not-a-printer";
const STORE_MAC = "00:11:62:00:00:0B";

async function openPos(page: Page): Promise<void> {
  await enableTestMode(page);
  await page.goto("/kitchen/pos");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  await expect(page.locator('[data-action="print"]')).toBeVisible();
}

/** One store-printer poll. Returns the delivery token, or null for no job. */
async function poll(page: Page): Promise<string | null> {
  return page.evaluate(
    async ({ PRINT, STORE_MAC }) => {
      const res = await fetch(PRINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statusCode: "200 OK", printerMAC: STORE_MAC }),
      });
      const body = (await res.json()) as { jobReady?: boolean; jobToken?: string };
      return body.jobReady ? (body.jobToken ?? null) : null;
    },
    { PRINT, STORE_MAC },
  );
}

/** Fetch and confirm a delivery, as the printer does after printing it. */
async function printAndConfirm(page: Page, token: string): Promise<void> {
  await page.evaluate(
    async ({ PRINT, STORE_MAC, token }) => {
      const q = `token=${encodeURIComponent(token)}&mac=${encodeURIComponent(STORE_MAC)}`;
      await (await fetch(`${PRINT}?${q}&type=application/vnd.star.starprnt`)).arrayBuffer();
      await fetch(`${PRINT}?${q}&code=OK`, { method: "DELETE" });
    },
    { PRINT, STORE_MAC, token },
  );
}

test("the POS status line goes 已送出, 列印中, 已列印 with the seconds", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await context.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
  const page = await context.newPage();
  await openPos(page);

  // Empty the store queue first, so the next hand-over is this order's.
  for (let i = 0; i < 40; i++) {
    const token = await poll(page);
    if (!token) break;
    await printAndConfirm(page, token);
  }

  await tapDish(page, page.locator("button[data-item]:not([disabled])").first());
  const sheetAdd = page.getByRole("button", { name: /加入單據/ });
  if (await sheetAdd.isVisible().catch(() => false)) {
    await chooseRequired(page);
    await sheetAdd.click();
  }
  await page.locator('[data-context="takeout"]').click();
  await page.locator('[data-channel="phone"]').click();
  await page.locator('[data-action="details-done"]').click();
  await page.locator('[data-action="print"]').click();

  const line = page.locator("[data-print-track]");
  await expect(line).toHaveAttribute("data-print-track", "sent");
  await expect(line).toContainText("已送出");
  await expect(line.locator("[data-print-seconds]")).toContainText("秒");
  // The count moves while it waits.
  const first = Number(await line.locator("[data-print-seconds]").getAttribute("data-print-seconds"));
  await expect
    .poll(async () => Number(await line.locator("[data-print-seconds]").getAttribute("data-print-seconds")))
    .toBeGreaterThan(first);

  // The printer polls and is handed it: 列印中 on the next board poll.
  const token = await poll(page);
  expect(token).not.toBeNull();
  await expect(line).toHaveAttribute("data-print-track", "printing", { timeout: 10_000 });
  await expect(line).toContainText("列印中");

  // The printer confirms: 已列印, and the seconds stop.
  await printAndConfirm(page, token!);
  await expect(line).toHaveAttribute("data-print-track", "printed", { timeout: 10_000 });
  await expect(line).toContainText("已列印");
  const stopped = await line.locator("[data-print-seconds]").getAttribute("data-print-seconds");
  await page.waitForTimeout(2_000);
  await expect(line.locator("[data-print-seconds]")).toHaveAttribute("data-print-seconds", stopped!);
  await expect(line).not.toContainText("—");

  await context.close();
});
