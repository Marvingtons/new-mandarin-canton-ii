import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_BYPASS, E2E_DB_PORT, E2E_KITCHEN_PASSWORD } from "./env";
import { enableTestMode } from "./testMode";
// The sheet formats with the app's one money formatter, which has no
// thousands separator ("$1595.37"); a local en-US formatter disagreed as soon
// as a day passed $1,000.
import { formatCents } from "../../src/lib/money";

/**
 * 日結 Day report, from History.
 *
 *   SHEET   History's 日結 button opens the sheet; its summary and preview are
 *           today's numbers from the database, including orders seeded here.
 *           Nothing on the report is optional (日結 v2), so the sheet has no
 *           block toggles and neither the preview nor Print sends any
 *   PRINT   Print enqueues exactly ONE report print, however it is pressed,
 *           and the sheet moves on to the next #N. The kitchen-tablet and
 *           kitchen-ipad projects share one database and one business day,
 *           so another project may print the same day at the same moment:
 *           the #N expected is read from the sheet's own "Printed for this
 *           day" list just before pressing, and a press that loses the race
 *           (409, "another tablet just printed") is pressed again on the
 *           refreshed sheet, as staff would
 *   LAYOUT  with the sheet open: no sideways page scroll, no target under
 *           44px, at four tablet viewports
 *
 * Runs in kitchen-tablet (1180x820) and kitchen-ipad (iPad Pro 11). The orders
 * go through the real POS route and are accepted on the board's own action,
 * so they count as sold. No printer polls the e2e server, so a print stays
 * QUEUED, which is exactly "enqueued".
 */

interface Sheet {
  date: string;
  today: string;
  report: { scope?: string; code: string; columns: { all: { count: number; totalCents: number } } };
  suggestedStation: "online" | "store";
  nextSequence: number;
  prints: Array<{ sequence: number; status: string; station: string }>;
}

async function login(browser: Browser, viewport?: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext(viewport ? { viewport } : {});
  await context.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
  const page = await context.newPage();
  await enableTestMode(page);
  await page.goto("/kitchen/history");
  await page.locator('input[type="password"]').fill(E2E_KITCHEN_PASSWORD);
  // As kitchen-sound.spec.ts: `next start` issues a Secure cookie, which
  // WebKit refuses on this HTTP localhost harness, so the session the login
  // actually issued is re-set without Secure, in this test browser only.
  const webkit = page.context().browser()?.browserType().name() === "webkit";
  const response = webkit
    ? page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.startsWith("/kitchen"))
    : null;
  await page.locator('input[type="password"]').press("Enter");
  if (response) {
    const login = await response;
    const token = (await login.headerValue("set-cookie"))?.match(/nmc_kitchen=([^;]+)/)?.[1];
    expect(token).toBeTruthy();
    // Path "/", not the page's URL: a cookie set by URL is scoped to /kitchen
    // and would not reach /api/kitchen/**.
    await page.context().addCookies([{
      name: "nmc_kitchen", value: token!, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax", secure: false,
    }]);
    await page.reload();
  }
  await expect(page.locator('[data-testid="day-report-open"]')).toBeVisible();
  // A touch iPad is asked once whether to turn sound on; answer it, as staff
  // would, so it is not lying over the header.
  // The prompt can re-render or leave between isVisible() and the click (seen
  // on WebKit), and a bare click() then waits out the test on a detached
  // button. Retry briefly until it is gone, however it went.
  const notNow = page.getByRole("button", { name: "暫時不用" });
  await expect(async () => {
    if (await notNow.isVisible()) await notNow.click({ timeout: 1_000 });
    await expect(notNow).toBeHidden({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  return page;
}

async function sheetJson(page: Page, date?: string): Promise<Sheet> {
  return page.evaluate(async (d) => {
    const res = await fetch(`/api/kitchen/reports/daily${d ? `?date=${d}` : ""}`, { cache: "no-store" });
    return res.json();
  }, date);
}

/** A walk-in through the POS route, then 接單 on the board: a sold order. */
async function seedSoldOrder(page: Page, quantity: number): Promise<void> {
  const ok = await page.evaluate(async ([qty, bypass]) => {
    const res = await fetch("/api/kitchen/orders", {
      method: "POST",
      // The order gates' bypass, so lunch and store hours cannot refuse a
      // test run at 3am.
      headers: { "content-type": "application/json", "x-gate-bypass": bypass },
      body: JSON.stringify({
        lines: [{ itemId: "egg-rolls", sizeId: "regular", modifierIds: [], quantity: qty }],
        channel: "walk_in",
        customer: {},
        pickup: { time: "asap" },
        idempotencyKey: `e2e-day-report-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      }),
    });
    const body = (await res.json()) as { ok: boolean; order?: { id: number }; error?: string };
    if (!body.ok || !body.order) return `order: ${res.status} ${body.error ?? ""}`;
    const accept = await fetch(`/api/kitchen/orders/${body.order.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "accept" }),
    });
    return accept.ok ? true : `accept: ${accept.status}`;
  }, [quantity, E2E_BYPASS] as const);
  expect(ok, "seeded and accepted").toBe(true);
}

/**
 * Both printers' health, set directly as kitchen-unified.spec.ts does: specs
 * share one database, and an earlier one leaves the store printer out of paper.
 */
async function setPrinters(store: "ok" | "paper-out"): Promise<void> {
  const db = new Client({ host: "localhost", port: E2E_DB_PORT, user: "postgres", password: "postgres", database: "nmc_e2e" });
  await db.connect();
  try {
    await db.query(`delete from printer_station_status where tenant_id = 'new-mandarin-canton'`);
    await db.query(
      `insert into printer_station_status (tenant_id, station, last_seen_at, online, paper_out, cover_open, paper_low,
                                   status_code, printer_mac, blocked_since)
       values ('new-mandarin-canton', 'online', now(), true, false, false, false, '200 OK', '00116200000a', null),
              ('new-mandarin-canton', 'store', now(), $1, $2, false, false, $3, '00116200000b', $4::timestamptz)`,
      store === "ok"
        ? [true, false, "200 OK", null]
        : [false, true, "503 Paper Empty", new Date(Date.now() - 60_000).toISOString()],
    );
  } finally {
    await db.end();
  }
}

/**
 * The highest #N in the sheet's "Printed for this day" list, or 0 when the
 * day has no prints yet (the list is then not rendered).
 */
async function lastPrinted(dialog: Locator): Promise<number> {
  const seqs = await dialog.locator('[data-testid="report-earlier-seq"]').allTextContents();
  return seqs.reduce((n, s) => Math.max(n, Number(s.replace("#", ""))), 0);
}

/** Open the sheet on TODAY (it opens on yesterday before 4am). */
async function openSheet(page: Page): Promise<void> {
  await page.locator('[data-testid="day-report-open"]').click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-testid="report-summary"]')).toBeVisible();
  const { today, date } = await sheetJson(page);
  if (date !== today) await dialog.getByRole("button", { name: /後一天|Next day/ }).click();
}


test("the sheet previews today's totals and Print enqueues exactly one job", async ({ browser }, info) => {
  await setPrinters("ok");
  const page = await login(browser);
  const before = await sheetJson(page);
  const today = before.today;
  const baseline = await sheetJson(page, today);

  await seedSoldOrder(page, 2);
  await seedSoldOrder(page, 1);
  const seeded = await sheetJson(page, today);
  expect(seeded.report.columns.all.count).toBe(baseline.report.columns.all.count + 2);
  // 3 x Egg Rolls at $3.50, plus tax as stored.
  expect(seeded.report.columns.all.totalCents).toBeGreaterThan(baseline.report.columns.all.totalCents + 3 * 350);

  await openSheet(page);
  const dialog = page.getByRole("dialog");
  const all = seeded.report.columns.all;
  await expect(dialog.locator('[data-testid="report-summary"]')).toContainText(String(all.count));
  await expect(dialog.locator('[data-testid="report-summary"]')).toContainText(formatCents(all.totalCents));

  // The preview asks the renderer for exactly this day and the next #N: one
  // past the last print the sheet lists (the other project may have printed
  // since `seeded` was read, so the sheet's own list is the reference).
  const preview = dialog.locator('[data-testid="report-preview"]');
  await expect(preview).toBeVisible();
  const listed = await lastPrinted(dialog);
  const src = new URL((await preview.getAttribute("src"))!, "http://x");
  expect(src.pathname).toBe("/api/kitchen/reports/daily/preview");
  expect(src.searchParams.get("date")).toBe(today);
  expect(src.searchParams.get("sequence")).toBe(String(listed + 1));
  // The printer the sheet preselects is the server's suggestion: the one that
  // printed fewer tickets today (other specs print to the store printer).
  const station = (await sheetJson(page, today)).suggestedStation;
  expect(src.searchParams.get("station")).toBe(station);
  await expect(dialog.locator('[data-testid="report-printer-suggested"]')).toBeVisible();
  expect(src.searchParams.has("blocks")).toBe(false);
  // 範圍 All is the default, and sends no scope.
  expect(src.searchParams.has("scope")).toBe(false);
  // No optional-block toggles: the pressed-state buttons are the 範圍 Scope
  // three and the printer picker's two, and the 加印 Include group is gone.
  await expect(dialog.locator("button[aria-pressed]")).toHaveCount(5);
  await expect(dialog.locator('[data-testid="report-scope"] button[aria-pressed="true"]')).toHaveText(/全部|All/);
  await expect(dialog.getByRole("button", { name: /^(餐盤|熱賣 10|時段|Trays|Top 10|By hour)$/ })).toHaveCount(0);
  await expect(dialog.getByText(/加印|Include/)).toHaveCount(0);

  // And that render, from the same database, drawn here by the same
  // renderReportPng (scripts/report-preview.ts) so its numbers can be read
  // back and the PNG attached to the report.
  const pngPath = info.outputPath("day-report-preview.png");
  const { stdout } = await promisify(execFile)(
    "npx",
    ["tsx", "--conditions=react-server", "scripts/report-preview.ts", today, String(listed + 1), pngPath],
    { env: { ...process.env, DATABASE_URL: `postgresql://postgres:postgres@localhost:${E2E_DB_PORT}/nmc_e2e` } },
  );
  await info.attach("day report preview", { path: pngPath, contentType: "image/png" });
  const drawn = JSON.parse(stdout) as {
    count: number; totalCents: number; width: number; missing: number[];
    top: Array<{ name: string; quantity: number }>;
  };
  expect(drawn).toMatchObject({ count: all.count, totalCents: all.totalCents, width: 576, missing: [] });
  // 熱賣 TOP 5: at most five lines (the Egg Rolls seeded above make one),
  // one per dish, 中文 name only.
  expect(drawn.top.length).toBeGreaterThan(0);
  expect(drawn.top.length).toBeLessThanOrEqual(5);
  expect(new Set(drawn.top.map((d) => d.name)).size).toBe(drawn.top.length);
  for (const d of drawn.top) expect(d.name).not.toMatch(/[A-Za-z]/);

  // Print, pressed twice in quick succession: one job, numbered one past the
  // last print the sheet lists, and the request carries that number. The
  // body carries no `blocks`: there is nothing left to choose. A press that
  // loses the #N to the other project is refused (409) and the sheet moves
  // on; press again, as staff would, at most three times.
  const print = dialog.locator('[data-testid="report-print"]');
  const isPrintPost = (url: string) => new URL(url).pathname === "/api/kitchen/reports/daily/print";
  let printed: { sequence: number; requestKey: string } | null = null;
  for (let attempt = 1; attempt <= 3 && !printed; attempt++) {
    await expect(print).toBeEnabled();
    const previous = await lastPrinted(dialog);
    await expect(print).toContainText(`#${previous + 1}`);
    const keys: string[] = [];
    const collect = (r: import("@playwright/test").Request) => {
      if (r.method() === "POST" && isPrintPost(r.url())) keys.push((r.postDataJSON() as { requestKey: string }).requestKey);
    };
    page.on("request", collect);
    const request = page.waitForRequest((r) => r.method() === "POST" && isPrintPost(r.url()));
    const response = page.waitForResponse((r) => r.request().method() === "POST" && isPrintPost(r.url()));
    // A real double tap: both clicks in one browser task, before React has
    // re-rendered the button busy, so both run the handler. Two separate
    // Playwright clicks can straddle the first response and become two
    // presses (two prints), which is not what this checks.
    await print.evaluate((el: HTMLElement) => {
      el.click();
      el.click();
    });
    const sent = (await request).postDataJSON() as { sequence: number; requestKey: string };
    expect(Object.keys(sent).sort()).toEqual(["date", "requestKey", "scope", "sequence", "station"]);
    expect((sent as unknown as { scope: string }).scope).toBe("all");
    expect(sent.sequence, "the Print request carries previous + 1").toBe(previous + 1);
    const status = (await response).status();
    await expect.poll(() => keys.length, { message: "both taps reached the server" }).toBe(2);
    page.off("request", collect);
    expect(new Set(keys).size, "both taps sent the same request key (the second is a replay)").toBe(1);
    if (status === 409) {
      // Lost the race: the sheet says so and refreshes past the other print.
      await expect(dialog.locator('[data-testid="report-notice"]')).toBeVisible();
      await expect(print).not.toContainText(`#${previous + 1}`);
      continue;
    }
    expect(status).toBe(200);
    await expect(dialog.locator('[data-testid="report-notice"]')).toContainText(`#${previous + 1}`);
    printed = sent;
  }
  expect(printed, "a print was queued within three presses").not.toBeNull();
  const mine = printed!;

  // Exactly one row for this press (the second tap sent the same request
  // key, a replay), at that #N, QUEUED for the store printer.
  const db = new Client({ host: "localhost", port: E2E_DB_PORT, user: "postgres", password: "postgres", database: "nmc_e2e" });
  await db.connect();
  try {
    const { rows } = await db.query(
      `select sequence, status, station from report_prints where request_key = $1`,
      [mine.requestKey],
    );
    expect(rows).toEqual([{ sequence: mine.sequence, status: "QUEUED", station }]);
    const { rows: at } = await db.query(
      `select count(*)::int as n from report_prints where business_date = $1::date and sequence = $2`,
      [today, mine.sequence],
    );
    expect(at[0].n, "one print per #N").toBe(1);
  } finally {
    await db.end();
  }

  // The sheet lists it and offers a later #N (later still if the other
  // project printed meanwhile).
  await expect(dialog.locator('[data-testid="report-earlier-seq"]', { hasText: new RegExp(`^#${mine.sequence}$`) })).toHaveCount(1);
  expect(await lastPrinted(dialog)).toBeGreaterThanOrEqual(mine.sequence);
  const offered = Number((await print.textContent())?.match(/#(\d+)/)?.[1]);
  expect(offered).toBeGreaterThan(mine.sequence);
  await page.context().close();
});

test("範圍 Scope: Online only + Store only add up to All, and the preview follows it", async ({ browser }) => {
  await setPrinters("ok");
  const page = await login(browser);
  await seedSoldOrder(page, 1);
  const { today } = await sheetJson(page);
  const json = async (scope: string) =>
    (await page.evaluate(
      async ([d, s]) => (await fetch(`/api/kitchen/reports/daily?date=${d}&scope=${s}`, { cache: "no-store" })).json(),
      [today, scope] as const,
    )) as Sheet;
  const [all, online, store] = [await json("all"), await json("online"), await json("store")];
  expect(online.report.columns.all.count + store.report.columns.all.count).toBe(all.report.columns.all.count);
  expect(online.report.columns.all.totalCents + store.report.columns.all.totalCents).toBe(all.report.columns.all.totalCents);
  expect(store.report.columns.all.count).toBeGreaterThan(0);

  await openSheet(page);
  const dialog = page.getByRole("dialog");
  const scope = dialog.locator('[data-testid="report-scope"]');
  await scope.getByRole("button", { name: "店內" }).click();
  await expect(scope.getByRole("button", { name: "店內" })).toHaveAttribute("aria-pressed", "true");
  const preview = dialog.locator('[data-testid="report-preview"]');
  await expect.poll(async () => new URL((await preview.getAttribute("src"))!, "http://x").searchParams.get("scope")).toBe("store");
  await expect(dialog.locator('[data-testid="report-summary"]')).toContainText(String(store.report.columns.all.count));
  await expect(dialog.locator('[data-testid="report-summary"]')).toContainText(formatCents(store.report.columns.all.totalCents));
  const png = await page.evaluate(async (src) => {
    const res = await fetch(src);
    return { status: res.status, code: res.headers.get("x-report-code") };
  }, (await preview.getAttribute("src"))!);
  expect(png.status).toBe(200);
  expect(png.code).not.toBe(all.report.code);
  await page.context().close();
});

test("Print is disabled, with the reason, while the store printer is out of paper", async ({ browser }) => {
  await setPrinters("paper-out");
  try {
    const page = await login(browser);
    await openSheet(page);
    const dialog = page.getByRole("dialog");
    // The suggestion never lands on a printer that cannot print: it opens on
    // the online printer, with Print on.
    await expect(dialog.getByRole("button", { name: "網上打印機" })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.locator('[data-testid="report-print"]')).toBeEnabled();
    // Picking the store printer by hand: Print is off, and says why.
    await dialog.getByRole("button", { name: "店內打印機" }).click();
    await expect(dialog.locator('[data-testid="report-print"]')).toBeDisabled();
    await expect(dialog.getByRole("note")).toContainText("缺紙");
    // The online printer is fine: choosing it enables Print again.
    await dialog.getByRole("button", { name: "網上打印機" }).click();
    await expect(dialog.locator('[data-testid="report-print"]')).toBeEnabled();
    await page.context().close();
  } finally {
    await setPrinters("ok");
  }
});

for (const viewport of [
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1180, height: 820 },
  { width: 1366, height: 1024 },
]) {
  test(`sheet open: no sideways scroll and no target under 44px at ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    const page = await login(browser, viewport);
    await openSheet(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator('[data-testid="report-preview"]')).toBeVisible();

    const sideways = await page.evaluate(() => {
      const doc = document.scrollingElement as HTMLElement;
      const sheet = document.querySelector<HTMLElement>("dialog[open]")!;
      window.scrollTo(200, 0);
      sheet.scrollLeft = 200;
      return {
        page: doc.scrollWidth - doc.clientWidth,
        sheet: sheet.scrollWidth - sheet.clientWidth,
        scrolled: window.scrollX + sheet.scrollLeft,
        fits: sheet.getBoundingClientRect().right <= innerWidth && sheet.getBoundingClientRect().left >= 0,
      };
    });
    expect(sideways).toEqual({ page: 0, sheet: 0, scrolled: 0, fits: true });

    const small = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(
        "dialog[open] :is(button, input, select, textarea, a[href], output[tabindex])",
      )) {
        if (el.closest('[aria-hidden="true"]') || el.tabIndex < 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.width < 43.5 || r.height < 43.5) {
          out.push(`${el.tagName} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return out;
    });
    expect(small).toEqual([]);
    await page.context().close();
  });
}
