// 改單 EDIT ORDER, design-only mockups: the LIVE kitchen app with its DOM
// edited to show the proposed states. No app code is changed by this.
//
//   npm run build
//   npx tsx scripts/e2e-server.ts        # throwaway database; leave it running
//   node docs/edit-order/shoot.mjs
//
// Writes docs/edit-order/mock-<n>-<state>-<w>x<h>.png at 1024x768 and 768x1024.
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const SIZES = [
  [1024, 768],
  [768, 1024],
];

const browser = await chromium.launch({ channel: "chrome" });

async function session(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => localStorage.setItem("nmc-kitchen-sound", "off"));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/api/test-mode`);
  await page.locator('input[name="key"]').fill("e2e-gate-bypass");
  await page.getByRole("button", { name: "Turn on for 4 hours" }).click();
  await page.getByText("Test mode on").waitFor();
  await page.goto(`${BASE}/kitchen/pos`);
  await page.locator('input[type="password"]').fill("e2e-kitchen-password");
  await page.locator('input[type="password"]').press("Enter");
  await page.locator('[data-action="print"], [data-action="bar-print"]').first().waitFor({ state: "attached" });
  await page.waitForTimeout(1200);
  return { ctx, page };
}

/** The order being edited: B-00N, a phone order, three lines. */
async function placeOrder(page) {
  const res = await page.evaluate(async () => {
    const r = await fetch("/api/kitchen/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "phone",
        customer: { name: "", phone: "6195550101" },
        pickup: { time: "asap" },
        idempotencyKey: `edit-order-mock-${Date.now()}-${Math.random()}`,
        lines: [
          { itemId: "orange-flavored-chicken-special", sizeId: "individual", modifierIds: ["rice-fried"], quantity: 1, specialInstructions: "加辣" },
          { itemId: "mongolian-beef-special", sizeId: "individual", modifierIds: ["rice-steamed"], quantity: 2 },
          { itemId: "mandarin-special", sizeId: "party-tray", modifierIds: [], quantity: 1 },
        ],
      }),
    });
    return r.json();
  });
  if (!res.ok) throw new Error(`place order: ${JSON.stringify(res)}`);
  return res.order;
}

async function dish(page, id, portion = "individual") {
  const tile = page.locator(`button[data-item="${id}"]`).first();
  const portions = await tile.getAttribute("data-portions");
  await tile.click();
  if (portions !== null) await page.locator(`[data-sheet="portion"] [data-portion="${portion}"]`).click();
}

async function rest(page) {
  await page.mouse.move(1, 1);
  await page.waitForTimeout(400);
}

const shot = (page, name, w, h) =>
  page.screenshot({ path: join(here, `mock-${name}-${w}x${h}.png`) });

/* The proposed copy, as it would be in lib/kitchen/i18n.ts. */
const COPY = {
  edit: "改 Edit",
  editingSub: "Editing / 修改中",
  cancelEditing: "取消修改 Cancel editing",
  save: "儲存並列印改單",
  saveEn: "Save & print changes",
  noChanges: "沒有更改 No changes",
};

for (const [w, h] of SIZES) {
  const { ctx, page } = await session(w, h);
  const order = await placeOrder(page);
  const num = order.orderNumber;
  const wasTotal = `$${(order.totalCents / 100).toFixed(2)}`;
  const liveTotal = () =>
    page.evaluate(() => {
      // The total is the largest money figure on the ticket.
      const money = [...document.querySelectorAll("[data-ticket] span")].filter((x) => /^\$\d[\d,.]*$/.test(x.textContent.trim()));
      money.sort((a, b) => parseFloat(getComputedStyle(b).fontSize) - parseFloat(getComputedStyle(a).fontSize));
      return money[0]?.textContent.trim() ?? "";
    });

  /* ---------- 1. the board: 改 Edit beside 重印 Reprint ---------- */
  await page.goto(`${BASE}/kitchen`);
  const card = page.locator(`article[data-order-id="${order.id}"]`);
  await card.waitFor();
  await page.evaluate(
    ({ id, edit }) => {
      const card = document.querySelector(`article[data-order-id="${id}"]`);
      const group = card.querySelector('[role="group"]');
      const reprint = [...group.querySelectorAll("button")].find((b) => b.textContent.includes("重印"));
      const btn = reprint.cloneNode(true);
      // Same button, new label and shortcut key; the icon becomes a pencil.
      const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
      const texts = [];
      while (walker.nextNode()) texts.push(walker.currentNode);
      for (const t of texts) {
        if (t.textContent.trim() === "P") t.textContent = "E";
        else if (t.textContent.includes("重印")) t.textContent = edit;
      }
      const svg = btn.querySelector("svg");
      if (svg) {
        svg.innerHTML =
          '<path d="M4 20h4L19 9l-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13.5 6.5l4 4" stroke="currentColor" stroke-width="2"/>';
      }
      reprint.after(btn);
      btn.style.outline = "3px solid var(--color-staff-gold)";
      btn.style.outlineOffset = "2px";
    },
    { id: order.id, edit: COPY.edit },
  );
  await page.evaluate((id) => document.querySelector(`article[data-order-id="${id}"]`)?.scrollIntoView({ block: "center" }), order.id);
  await rest(page);
  await shot(page, "1-board-edit-button", w, h);

  /* ---------- 5. History: 已改 ×2, expanded to each revision's diff ---------- */
  await page.evaluate((id) => {
    const card = document.querySelector(`article[data-order-id="${id}"]`);
    const pills = card.querySelector("h3").nextElementSibling;
    const pill = document.createElement("span");
    pill.className = pills.lastElementChild.className;
    pill.style.cssText = "background:var(--color-staff-ink);color:var(--color-staff-panel)";
    pill.textContent = "已改 Edited ×2";
    pills.append(pill);
    const items = card.querySelector("ul");
    const panel = document.createElement("section");
    panel.style.cssText =
      "margin:0 20px 12px;border:2px solid var(--color-staff-line-strong);border-radius:14px;background:var(--color-staff-bg);padding:10px 14px";
    const rev = (n, time, lines, total) => `
      <div style="padding:8px 0;border-top:1px solid var(--color-staff-line)">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span style="font-weight:800;font-size:17px">第${n}次 Revision ${n}</span>
          <span style="font-size:14px;color:var(--color-staff-soft)">${time} · kitchen · ${total}</span>
        </div>
        <ul style="margin-top:4px;font-size:16px">${lines.map((l) => `<li style="padding:2px 0">${l}</li>`).join("")}</ul>
      </div>`;
    panel.innerHTML = `
      <button style="display:flex;width:100%;justify-content:space-between;align-items:center;min-height:44px;font-weight:700;font-size:16px">
        <span>修改紀錄 Edit history</span><span aria-hidden="true">▴</span>
      </button>
      ${rev(2, "6:51 PM", ["<b>改</b> 招牌大拼盤 Mandarin Special <b>餐盤 → 半盤</b>"], "$195.70 → $122.83")}
      ${rev(1, "6:42 PM", ["<b>+</b> 春卷 Egg Rolls ×1", "<b>改</b> 蒙古牛肉 Mongolian Beef <b>2 → 3</b>"], "$168.51 → $195.70")}
      <div style="padding-top:8px;border-top:1px solid var(--color-staff-line);font-size:14px;color:var(--color-staff-soft)">原單 Original · 6:31 PM · $168.51 · 3 items <span style="text-decoration:underline">查看 View</span></div>`;
    items.before(panel);
    card.scrollIntoView({ block: "start" });
    let box = card.parentElement;
    while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    (box ?? document.scrollingElement).scrollBy(0, -150);
  }, order.id);
  await rest(page);
  await shot(page, "5-history-revisions", w, h);

  /* ---------- 2. POS in edit mode, one line added, one quantity up ---------- */
  await page.goto(`${BASE}/kitchen/pos`);
  await page.locator('[data-action="print"], [data-action="bar-print"]').first().waitFor({ state: "attached" });
  await page.waitForTimeout(800);
  await dish(page, "orange-flavored-chicken-special");
  await dish(page, "mongolian-beef-special");
  await dish(page, "mongolian-beef-special");
  await dish(page, "mongolian-beef-special");
  await dish(page, "mandarin-special", "party-tray");
  await dish(page, "egg-rolls");
  // Portrait keeps the ticket in a drawer: open it.
  const open = page.locator('[data-action="bar-print"]:visible, [data-action="open-ticket"]:visible').first();
  if (w < h && (await open.count()) > 0 && !(await page.locator("[data-ticket]").isVisible())) {
    await page.locator('[data-action="open-ticket"], [data-bar] button').first().click().catch(() => {});
  }
  const editHeader = async (state) =>
    page.evaluate(
      ({ num, COPY, state, wasTotal }) => {
        const ticket = document.querySelector("[data-ticket]");
        const head = ticket.firstElementChild.firstElementChild;
        head.innerHTML = `
          <div style="display:flex;align-items:center;gap:12px;width:100%">
            <div style="min-width:0;flex:1">
              <div lang="zh-Hant" style="font-size:26px;font-weight:700;line-height:1.1;color:var(--color-staff-brand);white-space:nowrap">改單 ${num}</div>
              <div style="font-size:14px;color:var(--color-staff-soft);white-space:nowrap">${COPY.editingSub}</div>
            </div>
            <button style="border:2px solid var(--color-staff-brand);color:var(--color-staff-brand);background:var(--color-staff-panel);border-radius:12px;padding:4px 12px;min-height:48px;line-height:1.15;white-space:nowrap"><span lang="zh-Hant" style="display:block;font-weight:700;font-size:16px">取消修改</span><span style="display:block;font-size:13px">Cancel editing</span></button>
          </div>`;
        head.parentElement.style.background = "var(--color-staff-brand-tint)";
        head.parentElement.style.boxShadow = "inset 0 -3px 0 var(--color-staff-brand)";

        const lines = [...ticket.querySelectorAll("[data-line]")];
        // The line's second row (size / rice) says what moved on it.
        const tag = (line, text, gold) => {
          const sub = line.querySelector("button > span:nth-child(2) > span:nth-child(2) > span:first-child");
          if (!sub) return;
          sub.textContent = text;
          sub.style.cssText = `padding:0 7px;border-radius:999px;font-weight:800;${
            gold ? "background:var(--color-staff-gold);color:var(--color-staff-ink)" : "background:var(--color-staff-ink);color:var(--color-staff-panel)"
          }`;
        };
        if (state === "changed") {
          tag(lines[1], "原 2 → 3", false);
          tag(lines[3], "+ 新 New", true);
        }
        // Totals: old → new under the total.
        const total = [...ticket.querySelectorAll("span")].find((s) => s.textContent.trim() === "合計");
        const row = total?.closest("div");
        if (row && state === "changed" && !row.nextElementSibling?.dataset?.was) {
          const was = document.createElement("div");
          was.dataset.was = "1";
          was.style.cssText = "text-align:right;font-size:14px;color:var(--color-staff-soft);margin-top:-4px";
          was.textContent = `原合計 Was ${wasTotal}`;
          row.after(was);
        }
        // The phone-number nag does not apply: an edit keeps the customer.
        for (const p of ticket.querySelectorAll("p")) if (p.textContent.includes("電話號碼")) p.remove();
        const print = ticket.querySelector('[data-action="print"]');
        if (state === "changed") {
          print.innerHTML = `<span style="display:flex;flex-direction:column;align-items:center;line-height:1.15"><span lang="zh-Hant" style="font-size:19px;font-weight:700">${COPY.save}</span><span style="font-size:14px;font-weight:500">${COPY.saveEn}</span></span>`;
          print.style.display = "flex";
          print.style.justifyContent = "center";
          print.style.alignItems = "center";
          print.style.background = "var(--color-staff-brand)";
          print.style.color = "var(--color-staff-on-brand)";
          print.removeAttribute("disabled");
        } else {
          print.innerHTML = `<span style="display:flex;flex-direction:column;align-items:center;line-height:1.15"><span lang="zh-Hant" style="font-size:19px;font-weight:700">${COPY.save}</span><span style="font-size:14px">${COPY.noChanges}</span></span>`;
          print.setAttribute("disabled", "");
          print.style.background = "var(--color-staff-sunken)";
          print.style.color = "var(--color-staff-soft)";
        }
      },
      { num, COPY, state, wasTotal },
    );
  await editHeader("changed");
  await rest(page);
  await shot(page, "2-pos-editing", w, h);

  /* ---------- 4. the confirm sheet: the diff the kitchen will get ---------- */
  await page.evaluate(
    ({ num, COPY, wasTotal, newTotal }) => {
      const wrap = document.createElement("div");
      wrap.setAttribute("role", "dialog");
      wrap.dataset.sheet = "edit-confirm";
      wrap.style.cssText =
        `font-family:${getComputedStyle(document.querySelector("[data-ticket]")).fontFamily};` + "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;background:rgb(20 12 8 / .45)";
      const line = (badge, zh, en, extra = "", strike = false) => `
        <li style="display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--color-staff-line)">
          <span style="min-width:40px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--color-staff-ink);color:var(--color-staff-panel);font-weight:700;font-size:18px">${badge}</span>
          <span style="flex:1;min-width:0">
            <span lang="zh-Hant" style="display:block;font-size:22px;font-weight:700;${strike ? "text-decoration:line-through;text-decoration-thickness:3px" : ""}">${zh}</span>
            <span style="display:block;font-size:14px;color:var(--color-staff-soft)">${en}</span>
            ${extra}
          </span>
        </li>`;
      const head = (mark, zh, en, color) =>
        `<h3 style="margin:16px 0 2px;font-size:18px;font-weight:800;color:${color}">${mark} ${zh} <span style="font-weight:600">${en}</span></h3>`;
      wrap.innerHTML = `
        <div style="width:min(560px,100%);max-height:100%;overflow:auto;background:var(--color-staff-panel);border-radius:20px;box-shadow:0 20px 60px rgb(0 0 0 / .3);padding:22px 24px">
          <div style="display:flex;align-items:baseline;gap:10px">
            <h2 lang="zh-Hant" style="font-size:26px;font-weight:800">確認改單</h2>
            <span style="font-size:16px;color:var(--color-staff-soft)">Confirm changes · ${num} · 第1次</span>
          </div>
          <p style="margin-top:6px;font-size:15px;color:var(--color-staff-soft)">廚房會收到這張改單，只列出更改。 The kitchen gets a change ticket with only these lines.</p>
          ${head("+", "加", "Added", "var(--color-staff-ink)")}
          <ul>${line("×1", "春卷", "Egg Rolls")}</ul>
          ${head("改", "", "Changed", "var(--color-staff-ink)")}
          <ul>${line("×3", "蒙古牛肉", "Mongolian Beef", '<span style="display:inline-block;margin-top:4px;padding:2px 10px;border:2px solid var(--color-staff-ink);border-radius:8px;font-weight:800;font-size:20px">2 → 3</span>')}</ul>
          <p style="margin-top:10px;font-size:15px;color:var(--color-staff-soft)">其餘不變 Other 2 items unchanged</p>
          <div style="margin-top:14px;padding:12px 14px;border-radius:12px;background:var(--color-staff-bg);display:flex;justify-content:space-between;align-items:baseline">
            <span style="font-size:16px">合計 Total</span>
            <span><span style="font-size:16px;color:var(--color-staff-soft);text-decoration:line-through">${wasTotal}</span> <span style="font-size:16px">→</span> <span style="font-size:26px;font-weight:800">${newTotal}</span></span>
          </div>
          <div style="display:flex;gap:10px;margin-top:16px">
            <button style="flex:1;min-height:56px;border-radius:14px;background:var(--color-staff-sunken);font-weight:700;font-size:17px">返回修改 Keep editing</button>
            <button style="flex:1.6;min-height:56px;border-radius:14px;background:var(--color-staff-brand);color:var(--color-staff-on-brand);font-weight:700;font-size:17px;line-height:1.15"><span lang="zh-Hant" style="display:block;font-size:19px">${COPY.save}</span><span style="font-size:14px;font-weight:500">${COPY.saveEn}</span></button>
          </div>
        </div>`;
      // In portrait the ticket is a modal drawer in the top layer: the sheet
      // has to open inside it to sit above it, as a real nested sheet would.
      const host = document.querySelector("[data-ticket]")?.closest("dialog") ?? document.body;
      host.append(wrap);
    },
    { num, COPY, wasTotal, newTotal: await liveTotal() },
  );
  await rest(page);
  await shot(page, "4-confirm-diff", w, h);

  /* ---------- 3. edit mode with nothing changed: Save disabled ---------- */
  await page.goto(`${BASE}/kitchen/pos`);
  await page.locator('[data-action="print"], [data-action="bar-print"]').first().waitFor({ state: "attached" });
  await page.waitForTimeout(800);
  await dish(page, "orange-flavored-chicken-special");
  await dish(page, "mongolian-beef-special");
  await dish(page, "mongolian-beef-special");
  await dish(page, "mandarin-special", "party-tray");
  await editHeader("same");
  await rest(page);
  await shot(page, "3-pos-no-changes", w, h);

  await ctx.close();
}

await browser.close();
console.log("mockups written to", here);
