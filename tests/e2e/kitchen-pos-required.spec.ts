import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { E2E_DB_PORT, E2E_KITCHEN_PASSWORD } from "./env";
import { enableTestMode } from "./testMode";

/**
 * POS quick-add never makes a required choice for the caller. A Lunch Special
 * (entrée required) opens its sheet with nothing chosen, Add stays disabled
 * until staff pick, and the entrée they pick is what the ticket line and the
 * printed ticket say.
 *
 * The printed ticket is read with scripts/ticket-text.ts against the order
 * this spec just placed: its text from composeTicketSvg and its PNG from
 * renderTicket, the same render the printer gets. (Not through
 * /api/kitchen/orders/[id]/ticket: under `next start` that route fails to load
 * resvg, a Node-build problem the Worker does not have.)
 */

const ENTREE_3 = { en: "Sweet & Sour Pork", zh: "咕嚕肉" };

test("a Lunch Special opens its sheet, cannot be added unchosen, and prints entrée #3", async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await context.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
  const page = await context.newPage();
  await enableTestMode(page);
  await page.goto("/kitchen/pos");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  await expect(page.locator('[data-value="takeout"]')).toBeVisible();

  // Lunch is a time-gated category: open it by hand whatever the clock says.
  const lunchHours = page.getByRole("button", { name: "午餐時段" });
  if (await lunchHours.isVisible().catch(() => false)) {
    if ((await lunchHours.getAttribute("aria-pressed")) !== "true") await lunchHours.click();
  }
  await page.getByRole("navigation", { name: /分類/ }).getByRole("button", { name: /Lunch/ }).click();

  const ticket = page.getByRole("complementary", { name: "單據" });
  const lines = ticket.locator("[aria-expanded]");

  // Quick-add: the tap opens the sheet instead of adding a line.
  await page.locator('button[data-item="combo-lunch-15-75"]').click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(lines).toHaveCount(0);

  // Nothing chosen: every entrée option is unpressed and Add is disabled.
  const entree = sheet.locator("fieldset").filter({ has: page.locator("legend", { hasText: "主菜" }) });
  await expect(entree.locator('button[aria-pressed="true"]')).toHaveCount(0);
  const add = sheet.getByRole("button", { name: /加入單據/ });
  await expect(add).toBeDisabled();

  // Rice is required too and also starts unchosen; pick it alone first and
  // Add must still refuse, because the entrée is still missing.
  const rice = sheet.locator("fieldset").filter({ has: page.locator("legend", { hasText: "Rice" }) });
  await expect(rice.locator('button[aria-pressed="true"]')).toHaveCount(0);
  await rice.locator("button[aria-pressed]").first().click();
  await expect(add).toBeDisabled();
  await add.click({ force: true });
  await expect(lines).toHaveCount(0);

  // Choose entrée #3.
  const third = entree.locator("button[aria-pressed]").nth(2);
  await expect(third).toContainText(ENTREE_3.en);
  await third.click();
  await expect(third).toHaveAttribute("aria-pressed", "true");
  await expect(add).toBeEnabled();
  await add.click();
  await expect(sheet).toHaveCount(0);

  // The POS ticket line names the entrée.
  await expect(lines).toHaveCount(1);
  await expect(lines.first()).toContainText(ENTREE_3.zh);

  // Place it and read the stored order back.
  await page.locator('[data-context="takeout"]').click();
  await page.locator('[data-channel="phone"]').click();
  await page.getByLabel("客人姓名").fill("E2E Lunch Entree");
  await page.getByLabel("電話", { exact: true }).fill("6195550177");
  await page.locator('[data-action="details-done"]').click();
  const posted = page.waitForResponse(
    (r) => r.url().endsWith("/api/kitchen/orders") && r.request().method() === "POST",
  );
  await page.locator('[data-action="print"]').click();
  const body = (await (await posted).json()) as { ok: boolean; order: { id: number } };
  expect(body.ok).toBe(true);

  // The rendered ticket: its text from composeTicketSvg, and the PNG from
  // renderTicket (the printer's render), kept as an attachment.
  const pngPath = info.outputPath("lunch-entree-3-ticket.png");
  const { stdout } = await promisify(execFile)(
    "npx",
    ["tsx", "--conditions=react-server", "scripts/ticket-text.ts", String(body.order.id), pngPath],
    {
      env: {
        ...process.env,
        DATABASE_URL: `postgresql://postgres:postgres@localhost:${E2E_DB_PORT}/nmc_e2e`,
      },
    },
  );
  await info.attach("ticket", { path: pngPath, contentType: "image/png" });
  const rendered = JSON.parse(stdout) as { lines: string[]; missing: number[] };
  const text = rendered.lines.join("\n");
  expect(text).toContain("Lunch Special");
  expect(text).toContain(ENTREE_3.en);
  expect(text).toContain(ENTREE_3.zh);
  expect(rendered.missing).toEqual([]);

  await context.close();
});
