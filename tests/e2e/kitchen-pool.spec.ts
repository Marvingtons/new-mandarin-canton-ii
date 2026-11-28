import { expect, test, type Page } from "@playwright/test";
import { E2E_KITCHEN_PASSWORD } from "./env";
import { enableTestMode } from "./testMode";

/**
 * 印表機 PRINTER POOL on (the kitchen-pool project's own server,
 * PRINTER_POOL=on; docs/printer-pool.md):
 *
 *   - a PHONE order is printed by the ONLINE printer when that is the one
 *     polling: the pool ignores channel. The card keeps its 店內 Store lane
 *     (by channel) and shows a small printer icon naming the printer that
 *     printed it;
 *   - the header is one 印表機 pill with both printers;
 *   - the 日結 sheet has no printer to pick, and Print works.
 */

const PRINT = "/api/print/e2e-print-secret-not-a-printer";
const ONLINE_MAC = "00:11:62:00:00:0A";

async function signIn(page: Page): Promise<void> {
  await enableTestMode(page);
  await page.goto("/kitchen/pos");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  await expect(page.locator('[data-action="print"]')).toBeVisible();
}

/** Be the ONLINE printer until the queue is empty. */
async function printAsOnline(page: Page): Promise<number> {
  return page.evaluate(
    async ({ PRINT, MAC }) => {
      let printed = 0;
      for (let i = 0; i < 40; i++) {
        const poll = await (
          await fetch(PRINT, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ statusCode: "200 OK", printerMAC: MAC }),
          })
        ).json();
        if (!poll.jobReady) break;
        const token = encodeURIComponent(poll.jobToken);
        await (await fetch(`${PRINT}?token=${token}&mac=${encodeURIComponent(MAC)}&type=application/vnd.star.starprnt`)).arrayBuffer();
        await fetch(`${PRINT}?token=${token}&mac=${encodeURIComponent(MAC)}&code=OK`, { method: "DELETE" });
        printed++;
      }
      return printed;
    },
    { PRINT, MAC: ONLINE_MAC },
  );
}

test("a phone order prints on the online printer; the card keeps its Store lane and names the printer", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await context.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
  const page = await context.newPage();
  await signIn(page);
  await printAsOnline(page);

  const body = await page.evaluate(async () => {
    const res = await fetch("/api/kitchen/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "phone",
        customer: { phone: "6195550188" },
        pickup: { time: "asap" },
        idempotencyKey: `pool-spec-${Date.now()}-${Math.random()}`,
        lines: [{ itemId: "egg-rolls", sizeId: "regular", modifierIds: [], quantity: 1 }],
      }),
    });
    return res.json();
  });
  expect(body.ok, JSON.stringify(body)).toBe(true);

  await page.goto("/kitchen");
  const card = page.locator(`article[data-order-id="${body.order.id}"]`);
  await expect(card).toBeVisible();
  await expect(card.locator("[data-lane]")).toHaveAttribute("data-lane", "store");
  await expect(card.locator("[data-printed-on]")).toHaveCount(0);

  expect(await printAsOnline(page)).toBeGreaterThanOrEqual(1);
  await expect(card.locator("[data-printed-on]")).toHaveAttribute("data-printed-on", "online", { timeout: 10_000 });
  await expect(card.locator("[data-lane]")).toHaveAttribute("data-lane", "store");

  const pill = page.locator("[data-printers-pill]");
  await expect(pill).toHaveCount(1);
  await expect(pill.locator("[data-printer]")).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath("pool-board.png") });
  await context.close();
});

test("the 日結 sheet has no printer to pick, and Print queues the report", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await context.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
  const page = await context.newPage();
  await signIn(page);
  await printAsOnline(page);
  await page.goto("/kitchen/history");
  await page.locator('[data-testid="day-report-open"]').click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator('[data-testid="report-preview"]')).toBeVisible();
  await expect(dialog.getByText(/送往哪部打印機|Which printer/)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /網上打印機|店內打印機/ })).toHaveCount(0);
  // Only the 範圍 Scope buttons are left.
  await expect(dialog.locator("button[aria-pressed]")).toHaveCount(3);
  const print = dialog.locator('[data-testid="report-print"]');
  await expect(print).toBeEnabled();
  const sent = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/kitchen/reports/daily/print");
  const answered = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/kitchen/reports/daily/print");
  await print.click();
  expect(Object.keys((await sent).postDataJSON() as object)).not.toContain("station");
  expect((await answered).status()).toBe(200);
  await expect(dialog.locator('[data-testid="report-notice"]')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("pool-report-sheet.png") });
  await context.close();
});
