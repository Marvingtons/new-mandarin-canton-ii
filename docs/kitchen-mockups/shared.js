// Mockup helpers: the top bar, money, and the ?big=1 switch. Static data only.
const params = new URLSearchParams(location.search);
if (params.get("big") === "1") document.documentElement.classList.add("big");

const $ = (s) => document.querySelector(s);
const money = (c) => "$" + (c / 100).toFixed(2);
const shortMoney = (c) => (c % 100 === 0 ? "$" + c / 100 : money(c));

const ICON = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>',
  clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/></svg>',
};

function topBar(mode) {
  return `
  <header class="top">
    <div class="brandmark">
      <img src="../../public/brand/fu-yuan-seal.svg" alt="富源">
      <span class="one">New Mandarin Canton II <span class="k">· Kitchen</span></span>
    </div>
    <div class="seg" role="group" aria-label="Service">
      <button aria-pressed="${mode === "takeout"}"><span class="zh">外賣</span>Takeout</button>
      <button aria-pressed="${mode === "dine"}"><span class="zh">堂食</span>Dine-in</button>
    </div>
    <div class="top-right">
      <button class="btn btn-secondary btn-icon" aria-label="Search">${ICON.search}</button>
      <button class="btn btn-secondary btn-icon" aria-label="Switch to English">EN</button>
      <button class="btn btn-secondary btn-icon" aria-label="More">${ICON.more}</button>
    </div>
  </header>`;
}
