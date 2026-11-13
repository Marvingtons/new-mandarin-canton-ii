import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_DB_PORT, E2E_KITCHEN_PASSWORD } from "./env";
import { enableTestMode } from "./testMode";
import { chooseRequired } from "./posSheet";

/**
 * The board's cheap poll, in a real browser: while nothing changes it only
 * asks /api/kitchen/orders/version and gets 304s; an order placed on the POS
 * in a second tab is on the board within 5 seconds; a web order still chimes
 * and toasts, exactly as before.
 *
 * Audio is measured as in kitchen-sound.spec.ts: the page's own AudioContext
 * running and the chime's three oscillators started on it.
 */

const TENANT = "new-mandarin-canton";

declare global {
  interface Window {
    __audio: { contexts: AudioContext[]; oscillators: number };
  }
}

const oscillators = (page: Page) => page.evaluate(() => window.__audio.oscillators);
const card = (page: Page, number: string) =>
  page.locator("article").filter({ has: page.getByRole("heading", { name: number }) });

test("the board polls a version, picks up a POS order within 5 s, and still chimes for a web order", async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await context.addInitScript(() => {
    window.__audio = { contexts: [], oscillators: 0 };
    const w = window as unknown as Record<string, typeof AudioContext | undefined>;
    for (const name of ["AudioContext", "webkitAudioContext"]) {
      const Original = w[name];
      if (!Original) continue;
      const Wrapped = function (this: AudioContext, ...args: unknown[]) {
        const ctx = new (Original as unknown as new (...a: unknown[]) => AudioContext)(...args);
        window.__audio.contexts.push(ctx);
        const create = ctx.createOscillator.bind(ctx);
        ctx.createOscillator = () => {
          const osc = create();
          const start = osc.start.bind(osc);
          osc.start = (when?: number) => {
            window.__audio.oscillators++;
            start(when);
          };
          return osc;
        };
        return ctx;
      } as unknown as typeof AudioContext;
      Wrapped.prototype = Original.prototype;
      w[name] = Wrapped;
    }
  });
  const db = new Client({ host: "localhost", port: E2E_DB_PORT, user: "postgres", password: "postgres", database: "nmc_e2e" });
  await db.connect();
  const created: string[] = [];

  try {
    // ---- the board, sound on ----
    const board = await context.newPage();
    // Test mode, so the POS offers pickup times whatever the clock says.
    await enableTestMode(board);
    await board.goto("/kitchen");
    await board.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
    await board.locator('input[type="password"]').press("Enter");
    await expect(board.getByRole("navigation", { name: "廚房選單" })).toBeVisible();
    await board.getByRole("region", { name: "開啟這部平板的提示音？" }).getByRole("button", { name: "開啟聲音" }).click();
    await expect.poll(() => board.evaluate(() => window.__audio.contexts[0]?.state)).toBe("running");

    const calls: { path: string; status: number }[] = [];
    board.on("response", (r) => {
      const path = new URL(r.url()).pathname;
      if (path.startsWith("/api/kitchen/orders")) calls.push({ path, status: r.status() });
    });

    // ---- quiet: version polls only, every one a 304 ----
    await board.waitForTimeout(9_000);
    const quiet = calls.splice(0);
    expect(quiet.length).toBeGreaterThanOrEqual(2);
    expect(quiet).toEqual(quiet.map(() => ({ path: "/api/kitchen/orders/version", status: 304 })));

    // ---- an order placed on the POS in a second tab ----
    const pos = await context.newPage();
    await pos.goto("/kitchen/pos");
    await expect(pos.locator('[data-value="takeout"]')).toBeVisible();
    const ticket = pos.getByRole("complementary", { name: "單據" });
    await pos.locator("button[data-item]:not([disabled])").first().click();
    const sheetAdd = pos.getByRole("button", { name: /加入單據/ });
    if (await sheetAdd.isVisible().catch(() => false)) {
      await chooseRequired(pos);
      await sheetAdd.click();
    }
    await expect(ticket.locator("[aria-expanded]")).toHaveCount(1);
    await pos.locator('[data-context="takeout"]').click();
    await pos.locator('[data-channel="phone"]').click();
    await pos.getByLabel("客人姓名").fill("E2E Poll Test");
    await pos.getByLabel("電話", { exact: true }).fill("6195550166");
    await pos.locator('[data-action="details-done"]').click();
    const chimesBeforePos = await oscillators(board);
    await pos.locator('[data-action="print"]').click();
    const placed = pos.getByRole("status").filter({ hasText: /A-\d{3}/ });
    await expect(placed).toBeVisible();
    const number = (await placed.textContent())!.match(/A-\d{3}/)![0];
    created.push(number);

    // The board tab is still a visible tab, polling at 4 s.
    expect(await board.evaluate(() => document.hidden)).toBe(false);
    await expect(card(board, number)).toBeVisible({ timeout: 5_000 });
    // A store order was typed in at this counter: highlighted, not announced.
    expect(await oscillators(board)).toBe(chimesBeforePos);
    expect(calls.some((c) => c.path === "/api/kitchen/orders" && c.status === 200)).toBe(true);

    // Complete from ACCEPTED, undo from the collapsed strip, then check quiet polling again.
    await card(board, number).getByRole("button", { name: "接單", exact: true }).click();
    await expect(card(board, number).getByRole("button", { name: "完成", exact: true })).toBeEnabled();
    await card(board, number).getByRole("button", { name: "完成", exact: true }).click();
    const recent = board.locator("details").filter({ has: board.locator("summary", { hasText: "Recently done" }) });
    await expect(recent).not.toHaveAttribute("open", "");
    await recent.locator("summary").click();
    await expect(card(board, number)).toBeVisible();
    await card(board, number).getByRole("button", { name: "Undo / 復原 / Deshacer" }).click();
    await expect(board.locator("section article").filter({ has: board.getByRole("heading", { name: number }) })).toBeVisible();
    await expect.poll(async () => (await db.query(`select status from orders where tenant_id = $1 and order_number = $2`, [TENANT, number])).rows[0]?.status).toBe("ACCEPTED");
    // Let the changed version settle before measuring two quiet polls.
    await board.waitForTimeout(5_000);
    calls.splice(0);
    await board.waitForTimeout(9_000);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls).toEqual(calls.map(() => ({ path: "/api/kitchen/orders/version", status: 304 })));

    // ---- a web order still chimes and toasts ----
    const chimesBeforeWeb = await oscillators(board);
    await db.query(
      `insert into orders (tenant_id, order_number, business_date, status, idempotency_key, items, totals,
                           customer, phone_verified_at, pickup_at, channel, print_station)
       values ($1, 'A-778', (now() at time zone 'America/Los_Angeles')::date, 'QUEUED', $2,
               '[]', '{"subtotalCents":0,"taxCents":0,"tipCents":0,"totalCents":0}',
               '{"name":"Poll Web Test","phone":"+16195550178"}', now(), now() + interval '20 minutes', 'web', 'online')`,
      [TENANT, `e2e-poll-${Date.now()}`],
    );
    created.push("A-778");
    await expect.poll(() => oscillators(board), { timeout: 5_000 }).toBe(chimesBeforeWeb + 3);
    await expect(board.getByRole("status").filter({ hasText: "新網上訂單 A-778" })).toBeVisible({ timeout: 5_000 });
    await expect(card(board, "A-778")).toBeVisible();
  } finally {
    if (created.length > 0) {
      await db.query(`delete from orders where tenant_id = $1 and order_number = any($2::text[])`, [TENANT, created]);
    }
    await db.end();
    await context.close();
  }
});
