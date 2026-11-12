// Screenshots the RUNNING app in the mockups' states and sizes, and pairs each
// with its mockup shot: docs/kitchen-mockups/shots/compare/<screen>--<size>.png
// (mockup left, app right).
//
//   npm run build
//   npx tsx scripts/e2e-server.ts        # a throwaway database; leave it running
//   node docs/kitchen-mockups/shoot-app.mjs
//
// Seeds the room through the API (tables 3, 4+5, 1 and 6 seated), then backdates
// the seatings on the throwaway database so the minutes match the mockups.
import { chromium } from "playwright";
import pg from "pg";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appOut = join(here, "shots", "app");
const cmpOut = join(here, "shots", "compare");
mkdirSync(appOut, { recursive: true });
mkdirSync(cmpOut, { recursive: true });

const BASE = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const DB = `postgresql://postgres:postgres@localhost:${process.env.E2E_DB_PORT ?? 55441}/nmc_e2e`;
const PASSWORD = "e2e-kitchen-password";
const BYPASS = "e2e-gate-bypass";

const SIZES = [
  ["landscape", 1376, 1032, false],
  ["portrait", 1032, 1376, false],
  ["landscape-big", 1376, 1032, true],
  ["portrait-big", 1032, 1376, true],
];

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ deviceScaleFactor: 1 });
const page = await context.newPage();
await page.setViewportSize({ width: 1376, height: 1032 });
// Test mode is a POST with the key (GET only reports it): use the page's form.
await page.goto(`${BASE}/api/test-mode`);
await page.locator('input[name="key"]').fill(BYPASS);
await page.getByRole("button", { name: "Turn on for 4 hours" }).click();
await page.getByText("Test mode on").waitFor();
await page.goto(`${BASE}/kitchen/pos`);
await page.locator('input[type="password"]').fill(PASSWORD);
await page.locator('input[type="password"]').press("Enter");
await page.locator('[data-mode="dine_in"]').waitFor();

/* ---- the room: four seatings, backdated ---- */
const SEATED = [
  ["3", 4, 75],
  ["4+5", 8, 41],
  ["1", 2, 24],
  ["6", 2, 8],
];
for (const [label, guests] of SEATED) {
  const res = await page.request.post(`${BASE}/api/kitchen/orders`, {
    data: {
      lines: [{ itemId: "egg-rolls", sizeId: "regular", modifierIds: [], quantity: 2 }],
      channel: "dine_in",
      table: { label, guests },
      idempotencyKey: `shoot-${label}-${Date.now()}`,
    },
  });
  const body = await res.json();
  if (!body.ok && body.code !== "table_occupied") throw new Error(`seat ${label}: ${JSON.stringify(body)}`);
}
const db = new pg.Client({ connectionString: DB });
await db.connect();
for (const [label, , minutes] of SEATED) {
  await db.query(`update orders set created_at = now() - ($1 || ' minutes')::interval where table_label = $2`, [String(minutes), label]);
}
await db.end();

/* ---- helpers ---- */
const rail = (zh) => page.locator("nav button", { hasText: zh }).first().click();
const tile = (id) => page.locator(`button[data-item="${id}"]`).click();
const rest = async () => {
  await page.mouse.move(1, 1);
  await page.waitForTimeout(350);
};
async function shoot(name, size) {
  await rest();
  await page.screenshot({ path: join(appOut, `${name}--${size}.png`) });
}
async function setBig(on) {
  const isOn = await page.evaluate(() => document.querySelector("[data-kitchen-surface]")?.hasAttribute("data-large-text"));
  if (isOn === on) return;
  await page.getByRole("button", { name: /更多|More/ }).click();
  await page.getByRole("menuitemcheckbox", { name: /大字/ }).click();
  await page.keyboard.press("Escape");
}

async function buildFullTicket() {
  await page.locator('[data-context="takeout"]').click();
  await page.locator('[data-channel="phone"]').click();
  await page.getByLabel(/客人姓名|Customer name/).fill("陳太 Mrs. Chen");
  await page.getByLabel(/^電話$|^Phone$/).fill("6265550148");
  await page.locator('[data-action="details-done"]').click();
  await rail("招牌菜");
  await page.locator('[data-item="mandarin-special"] ~ button[data-item-size="alt"]').click();
  await tile("orange-flavored-chicken-special");
  await tile("orange-flavored-chicken-special");
  await rail("牛類");
  await tile("beef-broccoli");
  await rail("前菜");
  for (let i = 0; i < 3; i++) await tile("egg-rolls");
  await rail("湯類");
  await tile("hot-sour-soup");
  await rail("炒飯");
  await tile("house-special-fried-rice");
  // The chicken line: a note, then left open mid-edit as in the mockup.
  const chicken = page.getByRole("complementary").locator("[aria-expanded]").nth(1);
  await chicken.click();
  await page.getByRole("button", { name: /備註 Note/ }).click();
  await page.getByPlaceholder(/少辣|less spicy/).fill("少辣 Less spicy");
  await page.getByRole("button", { name: /備註 Note/ }).click();
  await rail("前菜");
}

for (const [size, w, h, big] of SIZES) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${BASE}/kitchen/pos`);
  await page.locator('[data-mode="takeout"]').waitFor();
  await setBig(big);

  await shoot("order-empty", size);
  await buildFullTicket();
  await shoot("order-6-items", size);

  await page.locator('[data-mode="dine_in"]').click();
  await page.locator('[data-table="9"]').waitFor();
  await shoot("floor-plan", size);
  await page.locator('[data-table="1"]').click();
  await shoot("floor-table-details", size);
  await page.getByRole("button", { name: /所有桌/ }).click();
  await page.locator('[data-table="2"]').click();
  await page.locator("[data-guests]").first().waitFor();
  await shoot("guest-count", size);
  await page.keyboard.press("Escape");
}
await setBig(false);

/* ---- side by side: mockup | app ---- */
const cmp = await browser.newPage();
for (const [size, w, h] of SIZES) {
  for (const name of ["order-empty", "order-6-items", "floor-plan", "floor-table-details", "guest-count"]) {
    // Inline, because a page set with setContent cannot load file: URLs.
    const inline = (path) => `data:image/png;base64,${readFileSync(path).toString("base64")}`;
    const mock = inline(join(here, "shots", `${name}--${size}.png`));
    const app = inline(join(appOut, `${name}--${size}.png`));
    await cmp.setViewportSize({ width: w * 2 + 48, height: h + 64 });
    await cmp.setContent(`<body style="margin:0;background:#2a2622;font:600 22px system-ui;color:#fff">
      <div style="display:flex;gap:16px;padding:8px 16px 0"><div style="width:${w}px">Mockup</div><div style="width:${w}px">App</div></div>
      <div style="display:flex;gap:16px;padding:8px 16px"><img src="${mock}" width="${w}" height="${h}"><img src="${app}" width="${w}" height="${h}"></div></body>`);
    await cmp.waitForLoadState("load");
    await cmp.screenshot({ path: join(cmpOut, `${name}--${size}.png`) });
  }
}
await browser.close();
console.log("wrote", appOut, "and", cmpOut);
