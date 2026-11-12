import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_DB_PORT, E2E_KITCHEN_PASSWORD } from "./env";

/**
 * The staff app as ONE application: the orders board with both stations, the
 * shared header with both printers, the same actions everywhere, and the
 * SaaS behaviours (optimistic with rollback, live arrivals, keyboard, confirm
 * only where destructive), at the three widths the counter and the office use.
 *
 * Runs against scripts/e2e-server.ts (production build, throwaway database),
 * which configures both printer MACs, so each station shows its own printer's
 * health. Set E2E_SHOTS=<dir> to save screenshots.
 */

test.describe.configure({ mode: "serial" });

const TENANT = "new-mandarin-canton";
const SHOTS = process.env.E2E_SHOTS;
const WIDTHS = [768, 1024, 1440] as const;

let page: Page;
let db: Client;

async function shot(name: string) {
  if (!SHOTS) return;
  await page.mouse.move(1, 1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

const LINE = {
  itemId: "kung-pao-chicken",
  nameEn: "Kung Pao Chicken",
  nameZh: "宮保雞丁",
  sizeId: "individual",
  sizeLabel: "Individual",
  sizeLabelZh: "單點",
  modifiers: [],
  quantity: 2,
  unitCents: 1650,
  lineCents: 3300,
};

let seq = 900;
async function seed(o: {
  channel: "web" | "phone" | "walk_in" | "dine_in";
  status: string;
  name: string;
  table?: string;
}): Promise<{ id: number; number: string }> {
  seq++;
  const number = `A-${seq}`;
  const { rows } = await db.query(
    `insert into orders (tenant_id, order_number, business_date, status, idempotency_key, items, totals,
                         customer, phone_verified_at, pickup_at, ready_from, ready_to, channel, print_station,
                         table_label, guest_count)
     values ($1, $2, (now() at time zone 'America/Los_Angeles')::date, $3, $4, $5, $6, $7, now(),
             now() + interval '25 minutes', now() + interval '20 minutes', now() + interval '30 minutes',
             $8, $9, $10, $11)
     returning id`,
    [
      TENANT,
      number,
      o.status,
      `e2e-unified-${seq}-${Date.now()}`,
      JSON.stringify([LINE]),
      JSON.stringify({ subtotalCents: 3300, taxCents: 289, tipCents: 0, totalCents: 3589 }),
      JSON.stringify({ name: o.name, phone: o.channel === "dine_in" ? "" : "+16195550142" }),
      o.channel,
      o.channel === "web" ? "online" : "store",
      o.table ?? null,
      o.table ? 4 : null,
    ],
  );
  return { id: Number(rows[0].id), number };
}

const card = (number: string) => page.locator("article").filter({ has: page.getByRole("heading", { name: number }) });

let web: { id: number; number: string };
let cooking: { id: number; number: string };

test.beforeAll(async ({ browser }) => {
  db = new Client({ host: "localhost", port: E2E_DB_PORT, user: "postgres", password: "postgres", database: "nmc_e2e" });
  await db.connect();

  web = await seed({ channel: "web", status: "QUEUED", name: "Online Queued" });
  cooking = await seed({ channel: "web", status: "ACCEPTED", name: "Online Cooking" });
  await seed({ channel: "phone", status: "PRINTED", name: "Phone Printed" });
  await seed({ channel: "dine_in", status: "PRINTED", name: "Table 7", table: "7" });
  await seed({ channel: "walk_in", status: "PRINT_FAILED", name: "Walk-in Failed" });
  await seed({ channel: "web", status: "COMPLETED", name: "Online Done" });

  // Online printer healthy; store printer out of paper for a minute.
  await db.query(`delete from printer_station_status where tenant_id = $1`, [TENANT]);
  await db.query(
    `insert into printer_station_status (tenant_id, station, last_seen_at, online, paper_out, cover_open, paper_low,
                                 status_code, printer_mac, blocked_since)
     values ($1, 'online', now(), true, false, false, false, '200 OK', '00116200000a', null),
            ($1, 'store',  now(), false, true, false, false, '503 Paper Empty', '00116200000b', now() - interval '1 minute')`,
    [TENANT],
  );

  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("/kitchen");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  await page.locator('input[type="password"]').press("Enter");
  await expect(page.getByRole("heading", { name: web.number })).toBeVisible();
});

test.afterAll(async () => {
  await page.close();
  await db.end();
});

test("the header shows both printers on every staff page", async () => {
  for (const path of ["/kitchen", "/kitchen/pos", "/kitchen/history"]) {
    await page.goto(path);
    const strip = page.getByRole("list", { name: "打印機狀態" });
    await expect(strip.getByRole("listitem")).toHaveCount(2);
    await expect(strip).toContainText("網上");
    await expect(strip).toContainText("店內");
    // Same header element and nav on all three.
    await expect(page.getByRole("navigation", { name: "廚房選單" })).toBeVisible();
  }
  await page.goto("/kitchen");
});

test("a printer that needs a person says which station and what to do", async () => {
  const strip = page.getByRole("list", { name: "打印機狀態" });
  await expect(strip.getByRole("listitem").filter({ hasText: "店內" })).toContainText("缺紙");
  await expect(page.getByRole("alert").filter({ hasText: "店內打印機缺紙" })).toBeVisible();
});

test("one board, both stations, with an obvious station filter", async () => {
  await expect(card(web.number)).toBeVisible();
  await expect(card(web.number)).toContainText("網上");
  await expect(page.locator("article").filter({ hasText: "Phone Printed" })).toContainText("店內");

  const stations = page.getByRole("group", { name: "打印站" });
  await stations.getByRole("button", { name: "網上" }).click();
  await expect(stations.getByRole("button", { name: "網上" })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/station=online/);
  await expect(page.locator("article").filter({ hasText: "Phone Printed" })).toHaveCount(0);
  await expect(card(web.number)).toBeVisible();

  await page.keyboard.press("3");
  await expect(page).toHaveURL(/station=store/);
  await expect(card(web.number)).toHaveCount(0);
  await page.keyboard.press("1");
  await expect(page).not.toHaveURL(/station=/);

  // Status filter: Done shows the completed order, which Active hides.
  await expect(page.locator("article").filter({ hasText: "Online Done" })).toHaveCount(0);
  await page.getByRole("group", { name: "狀態" }).getByRole("button", { name: /已完成/ }).click();
  await expect(page.locator("article").filter({ hasText: "Online Done" })).toBeVisible();
  await page.getByRole("button", { name: "清除篩選" }).first().click();
});

test("accept is optimistic; a refused action rolls back with a toast", async () => {
  await card(web.number).getByRole("button", { name: /接單/ }).click();
  await expect(card(web.number)).toContainText("製作中");
  await expect(page.getByRole("status").filter({ hasText: `${web.number} 已接單` })).toBeVisible();

  // The server refuses the next action.
  await page.route(`**/api/kitchen/orders/${cooking.id}`, (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) }),
  );
  await card(cooking.number).getByRole("button", { name: /完成/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: cooking.number })).toBeVisible();
  await expect(card(cooking.number)).toContainText("製作中");
  await page.unroute(`**/api/kitchen/orders/${cooking.id}`);
});

test("cancel asks first; going back changes nothing", async () => {
  await card(cooking.number).getByRole("button", { name: /^取消/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(cooking.number);
  await shot("confirm-cancel");
  await dialog.getByRole("button", { name: "返回" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card(cooking.number)).toContainText("製作中");
});

test("reprint lets staff pick the printer, current one preselected", async () => {
  const { rows: before } = await db.query(`select status from orders where id = $1`, [web.id]);
  await card(web.number).getByRole("button", { name: /重印/ }).click();
  const dialog = page.getByRole("dialog");
  const picker = dialog.getByRole("group", { name: "送往哪部打印機？" });
  await expect(picker.locator('[data-value="online"]')).toHaveAttribute("aria-pressed", "true");
  await picker.locator('[data-value="store"]').click();
  await shot("reprint-dialog");
  await dialog.getByRole("button", { name: /^重印/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "已送往店內打印機" })).toBeVisible();
  // A reprint asks for a copy on the printer picked; the order itself does
  // not move: same station, same status, and one manual_reprint row naming
  // the store printer.
  const { rows } = await db.query(`select print_station, status from orders where id = $1`, [web.id]);
  expect(rows[0]).toEqual({ print_station: "online", status: before[0].status });
  const { rows: marks } = await db.query(
    `select station from print_deliveries where order_id = $1 and reason = 'manual_reprint'`,
    [web.id],
  );
  expect(marks.map((r) => r.station)).toEqual(["store"]);
  await expect(card(web.number)).toBeVisible();
});

test("a new online order arrives on its own, with a cue", async () => {
  const arrival = await seed({ channel: "web", status: "QUEUED", name: "Just Arrived" });
  await expect(page.getByRole("status").filter({ hasText: `新網上訂單 ${arrival.number}` })).toBeVisible({ timeout: 15_000 });
  await expect(card(arrival.number)).toBeVisible();
  await expect(card(arrival.number)).toContainText("新單");
  await shot("arrival");
});

test("keyboard: J selects an order, A accepts it", async () => {
  await page.mouse.click(5, 300);
  await page.keyboard.press("j");
  // J moves on from whatever is selected (the reprint above left its card
  // selected, and a reprint no longer moves that card), so walk back to the
  // top: the first card is the walk-in that did not print.
  for (let i = 0; i < 12; i++) await page.keyboard.press("k");
  const selected = page.locator("article.ring-3");
  await expect(selected).toHaveCount(1);
  const number = (await selected.locator("h3").textContent())!.trim();
  // The first card is the walk-in that did not print: not yet accepted.
  await page.keyboard.press("a");
  await expect(card(number)).toContainText("製作中");
  await expect(page.getByRole("status").filter({ hasText: `${number} 已接單` })).toBeVisible();

  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "快捷鍵" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const width of WIDTHS) {
  test(`layout at ${width}px: nothing overflows, every target is 44px`, async () => {
    await page.setViewportSize({ width, height: width === 768 ? 1024 : 900 });
    for (const [path, name] of [
      ["/kitchen", "board"],
      ["/kitchen/pos", "pos"],
      ["/kitchen/history", "history"],
    ] as const) {
      await page.goto(path);
      await page.waitForTimeout(800);
      const report = await page.evaluate(() => {
        const surface = document.querySelector<HTMLElement>("[data-kitchen-surface]")!;
        const overflow = surface.scrollWidth - surface.clientWidth;
        const small: string[] = [];
        for (const el of surface.querySelectorAll<HTMLElement>("button, a[href], input, select, [role='menuitem']")) {
          if (el.offsetParent === null) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          // Inline text links inside a sentence are exempt (WCAG 2.5.8).
          if (el.tagName === "A" && getComputedStyle(el).display === "inline") continue;
          if (r.height < 43.5 || r.width < 43.5) {
            small.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        }
        return { overflow, small };
      });
      await shot(`${name}-${width}`);
      expect(report.overflow, `${path} at ${width}px scrolls sideways`).toBeLessThanOrEqual(0);
      expect(report.small, `${path} at ${width}px has targets under 44px`).toEqual([]);
    }
  });
}
