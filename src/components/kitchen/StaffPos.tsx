"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Menu, MenuCategory, MenuItem } from "@/lib/menu/types";
import { indexItems, isAvailable, itemSizes } from "@/lib/menu/types";
import { resolveLinePrice } from "@/lib/cart/pricing";
import { itemMatches, queryTerms } from "@/lib/menu/search";
import { formatCents, taxCents } from "@/lib/money";
import { formatPhoneAsTyped, normalizePhone } from "@/lib/phone";
import { staffPickupSlots, clockLabel, type PickupOptions } from "@/lib/order/pickup";
import { isLunchService, LUNCH_END_MINUTES, LUNCH_START_MINUTES } from "@/lib/order/gates";
import { resolveSizeZh } from "@/data/menu-overrides";
import { menuNumber } from "@/data/menu-presentation";
import type { OrderLine, StaffTakeoutChannel } from "@/lib/orders/types";
import { useKT } from "@/components/kitchen/KitchenI18n";
import DishName from "@/components/kitchen/DishName";
import StaffItemSheet, { type StaffLineDraft } from "@/components/kitchen/StaffItemSheet";
import Icon from "@/components/kitchen/Icon";
import FloorPlanSheet, { type Seating } from "@/components/kitchen/FloorPlanSheet";
import type { KitchenKey } from "@/lib/kitchen/i18n";

/**
 * Staff order entry: a phone call, a walk-in, or a table, tapped in and printed.
 *
 * THIS SCREEN PRICES NOTHING. The totals it shows are resolveLinePrice and
 * taxCents, the same pure functions the server uses, purely so staff can quote
 * the caller a number; the order that prints is the one POST /api/kitchen/orders
 * recomputes from the menu. The request carries no money at all.
 *
 * TWO SERVICES, ONE SCREEN. A full-width 外賣 / 堂食 switch at the top. Takeout
 * asks phone or walk-in, then who and when; dine-in asks only which table and
 * how many (the floor plan sheet), and shows that in large type at the top of
 * the ticket. The dishes and the Print button are the same for both, and so
 * is the order route: one pipeline (see POST /api/kitchen/orders).
 *
 * READ AT ARM'S LENGTH. The people using this include older staff with poor
 * eyesight. Dish 中文 is the largest type on a card, prices are bold, there are
 * no descriptions and no pale captions, and every control is at least 64px
 * (globals.css sets the staff type scale; 大字 in the nav scales it again).
 * Three dish columns on a landscape tablet, two in portrait.
 *
 * Every dish shows 中文 large and English beneath regardless of the language
 * toggle, because the person taking the call and the person at the wok may
 * read different ones.
 */

type Mode = "takeout" | "dine_in";

interface TicketLine extends StaffLineDraft {
  lineId: string;
}

interface Placed {
  id: number;
  orderNumber: string;
  totalCents: number;
}

interface PastOrder {
  id: number;
  orderNumber: string;
  businessDate: string;
  totalCents: number;
  items: OrderLine[];
}

const JUST_NOW_MS = 2 * 60_000;
/** The panes fill the screen under the sticky nav, whose height KitchenShell measures. */
const NAV_OFFSET = "md:h-[calc(100svh-var(--kitchen-nav-h,6rem))]";

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isDefaultSize(label: string): boolean {
  return ["individual", "regular", ""].includes(label.toLowerCase());
}

export default function StaffPos({
  menu,
  taxRateBps,
  pickupOptions,
  asIfOpen,
}: {
  menu: Menu;
  taxRateBps: number | null;
  pickupOptions: PickupOptions;
  /** Test-mode session: show pickup times as if the store were open. */
  asIfOpen: boolean;
}) {
  const t = useKT();
  const index = useMemo(() => indexItems(menu), [menu]);

  /* ---------------------------------------------------------- the clock -- */
  // Client-only, so the server render and hydration agree (no slot list that
  // differs by a minute between the two). Ticks every 30s for the slot list
  // and the lunch window.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const lunchNow = now ? isLunchService(now, pickupOptions) : false;
  const [lunchOverride, setLunchOverride] = useState(false);
  const lunchOpen = lunchNow || lunchOverride;
  const lunchLabel = {
    from: clockLabel(LUNCH_START_MINUTES),
    to: clockLabel(LUNCH_END_MINUTES),
  };

  const slots = useMemo(
    () => (now ? staffPickupSlots(now, pickupOptions, { asIfOpen }) : []),
    [now, pickupOptions, asIfOpen],
  );

  /* ---------------------------------------------------------- the ticket -- */
  const [lines, setLines] = useState<TicketLine[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [mode, setMode] = useState<Mode>("takeout");
  const [channel, setChannel] = useState<StaffTakeoutChannel>("phone");
  const [seating, setSeating] = useState<Seating | null>(null);
  const [floorOpen, setFloorOpen] = useState(false);
  const [pickup, setPickup] = useState("asap");
  const [paymentNote, setPaymentNote] = useState("");
  const [staffNote, setStaffNote] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [justNow, setJustNow] = useState<Placed | null>(null);
  const [clearArmed, setClearArmed] = useState(false);

  // A chosen slot that has since passed falls back to the first one offered.
  const pickupValue = slots.some((s) => s.value === pickup) ? pickup : (slots[0]?.value ?? "");

  const priced = useMemo(
    () =>
      lines.map((line) => {
        const item = index.get(line.itemId);
        let lineCents = 0;
        try {
          if (item) lineCents = resolveLinePrice(item, line.sizeId, line.modifierIds, line.quantity).lineCents;
        } catch {
          lineCents = 0;
        }
        return { line, item, lineCents };
      }),
    [lines, index],
  );
  const subtotal = priced.reduce((n, p) => n + p.lineCents, 0);
  const tax = taxRateBps == null ? 0 : taxCents(subtotal, taxRateBps);
  const total = subtotal + tax;
  const hasLunchLine = priced.some((p) => p.item?.lunchSpecial);

  const phoneCheck = phone.trim() ? normalizePhone(phone) : null;
  const phoneE164 = phoneCheck?.ok ? (phoneCheck.e164 ?? null) : null;
  const phoneBad = phoneCheck !== null && !phoneCheck.ok;

  const missing: KitchenKey[] = [];
  if (lines.length === 0) missing.push("pos.missing.lines");
  if (mode === "dine_in") {
    if (!seating) missing.push("pos.missing.table");
  } else {
    if (!name.trim()) missing.push("pos.missing.name");
    if (channel === "phone" && !phoneE164) missing.push("pos.missing.phone");
  }
  const canSubmit =
    missing.length === 0 &&
    !submitting &&
    taxRateBps != null &&
    (mode === "dine_in" || (!phoneBad && pickupValue !== ""));

  /* ------------------------------------------------------ menu selection -- */
  const [query, setQuery] = useState("");
  const [sheetItem, setSheetItem] = useState<MenuItem | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>(menu.categories[0]?.id ?? "");
  const ticketPaneRef = useRef<HTMLElement>(null);

  const lunchCategoryIds = useMemo(
    () => new Set(menu.categories.filter((c) => c.items.some((i) => i.lunchSpecial)).map((c) => c.id)),
    [menu],
  );

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    const all = menu.categories.flatMap((c) => c.items.map((item) => ({ item, category: c })));
    if (/^\d+$/.test(q)) {
      // A printed menu number: "23" is #23, "2" is #2 then #20 to #29.
      return all
        .filter(({ item }) => String(menuNumber(item.id) ?? "").startsWith(q))
        .sort((a, b) => (menuNumber(a.item.id) ?? 0) - (menuNumber(b.item.id) ?? 0))
        .map(({ item }) => item);
    }
    const terms = queryTerms(q);
    return all
      .filter(({ item, category }) =>
        itemMatches(item, terms, `${category.nameEn} ${category.nameZh ?? ""} ${menuNumber(item.id) ?? ""}`),
      )
      .map(({ item }) => item);
  }, [query, menu]);

  const orderable = useCallback(
    (item: MenuItem) => isAvailable(item) && (!item.lunchSpecial || lunchOpen),
    [lunchOpen],
  );

  /* The highlighted category follows the scroll, not just the last tap, so
     the rail always says where the dishes on screen come from. */
  const dishPaneRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const pane = dishPaneRef.current;
    if (!pane || results) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActiveCategory(top.target.id.replace(/^pos-cat-/, ""));
      },
      // On a phone the page scrolls, not the pane: watch the viewport then.
      { root: pane.scrollHeight > pane.clientHeight ? pane : null, rootMargin: "0px 0px -70% 0px" },
    );
    for (const c of menu.categories) {
      const el = document.getElementById(`pos-cat-${c.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [menu, results]);

  function jumpTo(category: MenuCategory) {
    setQuery("");
    setActiveCategory(category.id);
    // After the search results unmount, so the section is in the DOM.
    requestAnimationFrame(() => {
      document.getElementById(`pos-cat-${category.id}`)?.scrollIntoView({ block: "start" });
    });
  }

  function addLine(draft: StaffLineDraft) {
    setLines((prev) => {
      // Same dish, same choices, no note: bump the quantity rather than add a
      // second identical row the kitchen has to sum.
      const same = prev.find(
        (l) =>
          !l.specialInstructions &&
          !draft.specialInstructions &&
          l.itemId === draft.itemId &&
          l.sizeId === draft.sizeId &&
          [...l.modifierIds].sort().join() === [...draft.modifierIds].sort().join(),
      );
      if (same) {
        return prev.map((l) =>
          l.lineId === same.lineId ? { ...l, quantity: Math.min(50, l.quantity + draft.quantity) } : l,
        );
      }
      return [...prev, { ...draft, lineId: newKey() }];
    });
    setSheetItem(null);
    setPlaced(null);
    setError(null);
  }

  function setQty(lineId: string, quantity: number) {
    setLines((prev) =>
      quantity < 1 ? prev.filter((l) => l.lineId !== lineId) : prev.map((l) => (l.lineId === lineId ? { ...l, quantity: Math.min(50, quantity) } : l)),
    );
  }

  /* --------------------------------------------------- repeat customers -- */
  const [returning, setReturning] = useState<{ phone: string; name: string | null; orders: PastOrder[] } | null>(null);
  useEffect(() => {
    if (!phoneE164) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/kitchen/customers?phone=${encodeURIComponent(phoneE164)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { ok: boolean; name: string | null; orders: PastOrder[] };
        if (data.ok) setReturning({ phone: phoneE164, name: data.name, orders: data.orders });
      } catch {
        /* lookup is a convenience; silence is fine */
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [phoneE164]);
  const returningHere = returning && returning.phone === phoneE164 && returning.orders.length > 0 ? returning : null;

  function reorder(order: PastOrder) {
    let skipped = 0;
    const drafts: TicketLine[] = [];
    for (const line of order.items) {
      const item = index.get(line.itemId);
      const modifierIds = line.modifiers.map((m) => m.id);
      let ok = !!item && orderable(item) && itemSizes(item).some((s) => s.id === line.sizeId);
      if (ok && item) {
        try {
          resolveLinePrice(item, line.sizeId, modifierIds, line.quantity);
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        skipped++;
        continue;
      }
      drafts.push({
        lineId: newKey(),
        itemId: line.itemId,
        sizeId: line.sizeId,
        modifierIds,
        quantity: line.quantity,
        specialInstructions: line.specialInstructions,
      });
    }
    setLines((prev) => [...prev, ...drafts]);
    if (!name.trim() && returningHere?.name) setName(returningHere.name);
    setNotice(skipped > 0 ? t("pos.reorderSkipped", { n: skipped }) : null);
    setPlaced(null);
  }

  /* ------------------------------------------------------------- submit -- */
  function resetTicket() {
    setLines([]);
    setName("");
    setPhone("");
    setChannel("phone");
    setSeating(null);
    setPickup("asap");
    setPaymentNote("");
    setStaffNote("");
    setLunchOverride(false);
    setIdempotencyKey(newKey());
    setReturning(null);
    setClearArmed(false);
    setNotice(null);
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/kitchen/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lines: lines.map((l) => ({
            itemId: l.itemId,
            sizeId: l.sizeId,
            modifierIds: l.modifierIds,
            quantity: l.quantity,
            ...(l.specialInstructions ? { specialInstructions: l.specialInstructions } : {}),
          })),
          ...(mode === "dine_in" && seating
            ? {
                channel: "dine_in",
                table: { label: seating.label, guests: seating.guests },
                ...(seating.addon ? { addon: true } : {}),
              }
            : {
                channel,
                customer: { name: name.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}) },
                pickup: { time: pickupValue },
              }),
          ...(paymentNote.trim() ? { paymentNote: paymentNote.trim() } : {}),
          ...(staffNote.trim() ? { staffNote: staffNote.trim() } : {}),
          ...(lunchOverride && hasLunchLine && !lunchNow ? { lunchOverride: true } : {}),
          idempotencyKey,
        }),
      });
      if (res.status === 429) {
        setError(t("pos.error.rate"));
        return;
      }
      const data = (await res.json()) as {
        ok: boolean;
        code?: string;
        error?: string;
        order?: Placed;
      };
      if (!data.ok || !data.order) {
        const code = data.code ?? "unavailable";
        // The table changed under us (another tablet seated or cleared it):
        // drop the stale seating so the next tap shows the real room.
        if (code === "table_occupied" || code === "table_not_open") setSeating(null);
        setError(
          code === "rejected"
            ? t("pos.error.rejected", { detail: data.error ?? "" })
            : t(`pos.error.${code}` as KitchenKey),
        );
        return;
      }
      setPlaced(data.order);
      setJustNow(data.order);
      // The mode survives: the next order is most likely the same service.
      resetTicket();
      setQuery("");
      // The order number is the one thing staff must see next, and it sits at
      // the top of the ticket pane, which is usually scrolled down to the
      // Print button by now. On a phone the panes stack, so bring it into view.
      ticketPaneRef.current?.scrollTo({ top: 0 });
      ticketPaneRef.current?.scrollIntoView({ block: "start" });
    } catch {
      setError(t("pos.error.network"));
    } finally {
      setSubmitting(false);
    }
  }

  // The "just now" chip lives for two minutes after the order it names.
  useEffect(() => {
    if (!justNow) return;
    const id = setTimeout(() => setJustNow(null), JUST_NOW_MS);
    return () => clearTimeout(id);
  }, [justNow]);

  useEffect(() => {
    if (!clearArmed) return;
    const id = setTimeout(() => setClearArmed(false), 4000);
    return () => clearTimeout(id);
  }, [clearArmed]);

  async function reprint(order: Placed) {
    try {
      const res = await fetch(`/api/kitchen/orders/${order.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reprint" }),
      });
      const data = (await res.json()) as { ok: boolean };
      setNotice(data.ok ? t("pos.reprinted", { number: order.orderNumber }) : t("board.actionFailed"));
    } catch {
      setNotice(t("board.actionUnreachable"));
    }
  }

  /* ------------------------------------------------------------- render -- */
  const itemCard = (item: MenuItem) => {
    const num = menuNumber(item.id);
    const sizes = itemSizes(item);
    const tray = sizes.find((s) => s.id === "party-tray");
    const eightySixed = !isAvailable(item);
    const lunchLocked = item.lunchSpecial === true && !lunchOpen;
    const disabled = eightySixed || lunchLocked;
    // 中文, English, price. No description: read at arm's length, a card is
    // a name to recognise, not a paragraph to read.
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => setSheetItem(item)}
        disabled={disabled}
        data-item={item.id}
        className={`flex min-h-36 flex-col gap-2 rounded-xl border-2 p-4 text-left transition-colors ${
          disabled
            ? "cursor-not-allowed border-transparent bg-staff-sunken"
            : "border-staff-line-strong bg-staff-panel hover:border-staff-ink active:bg-staff-accent-tint"
        }`}
      >
        <DishName nameZh={item.nameZh} nameEn={item.nameEn} />
        <span className="mt-auto flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-lg font-bold">{formatCents(sizes[0].priceCents)}</span>
          {num !== null && <span className="text-base">{t("pos.dish.number", { n: num })}</span>}
        </span>
        {(tray || eightySixed || lunchLocked) && (
          <span className="flex flex-wrap items-center gap-2">
            {tray && (
              <span className="text-base font-semibold">
                {resolveSizeZh(tray.label) ?? tray.label} {formatCents(tray.priceCents)}
              </span>
            )}
            {eightySixed && (
              <span className="rounded-full bg-staff-danger-tint px-3 py-0.5 text-base font-bold text-staff-danger">{t("pos.86d")}</span>
            )}
            {!eightySixed && lunchLocked && (
              <span className="rounded-full border-2 border-staff-line-strong px-3 py-0.5 text-base font-semibold">{t("pos.lunchClosed")}</span>
            )}
          </span>
        )}
      </button>
    );
  };

  const field =
    "min-h-12 w-full rounded-md border border-staff-line-strong bg-staff-panel px-3 text-base text-staff-ink outline-none placeholder:text-staff-faint focus:border-staff-accent";
  const label = "mb-1.5 block text-base font-semibold text-staff-ink";
  const segment = (on: boolean) =>
    `flex min-h-14 items-center justify-center gap-2 rounded-lg text-xl font-bold transition-colors ${
      on ? "bg-staff-ink text-staff-panel" : "text-staff-ink hover:bg-staff-panel"
    }`;
  const stepper = "flex h-12 w-12 items-center justify-center text-staff-ink hover:bg-staff-sunken";
  const itemCount = lines.reduce((n, l) => n + l.quantity, 0);

  return (
    <main
      className={`mx-auto grid w-full max-w-[1600px] grid-cols-1 md:grid-cols-[minmax(0,1fr)_18rem] md:grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_21rem] ${NAV_OFFSET}`}
    >
      {/* ------------------------------------------------- 外賣 | 堂食 -- */}
      <div role="group" aria-label={t("pos.mode")} className="grid grid-cols-2 gap-2 border-b border-staff-line bg-staff-panel p-2 md:col-span-2">
        {(["takeout", "dine_in"] as const).map((m) => {
          const on = mode === m;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              data-mode={m}
              onClick={() => {
                setMode(m);
                setError(null);
                // Straight to the floor plan: a dine-in order starts at a table.
                if (m === "dine_in" && !seating) setFloorOpen(true);
              }}
              className={`flex min-h-14 items-center justify-center gap-3 rounded-xl border-2 text-2xl font-bold transition-colors ${
                on
                  ? "border-staff-ink bg-staff-ink text-staff-panel"
                  : "border-staff-line-strong bg-staff-panel text-staff-ink hover:bg-staff-sunken"
              }`}
            >
              <Icon name={m === "takeout" ? "store" : "table"} size={28} />
              {t(m === "takeout" ? "pos.mode.takeout" : "pos.mode.dineIn")}
            </button>
          );
        })}
      </div>

      {/* --------------------------------------------------------- dishes -- */}
      <section ref={dishPaneRef} className="min-w-0 md:overflow-y-auto">
        <div className="sticky top-0 z-10 flex flex-col gap-2 bg-staff-bg px-3 pt-3 pb-2">
          {/* The category rail: one row of large chips across the dishes, the
              current one solid black, so it reads without colour. */}
          <nav aria-label={t("pos.categories")} className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
            {menu.categories.map((c) => {
              const on = activeCategory === c.id && !results;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => jumpTo(c)}
                  aria-current={on ? "true" : undefined}
                  className={`flex min-h-14 shrink-0 flex-col justify-center rounded-xl border-2 px-4 py-1 text-left transition-colors ${
                    on
                      ? "border-staff-ink bg-staff-ink text-staff-panel"
                      : "border-staff-line-strong bg-staff-panel text-staff-ink hover:bg-staff-sunken"
                  }`}
                >
                  <span lang={c.nameZh ? "zh-Hant" : "en"} className="text-xl leading-tight font-bold whitespace-nowrap">
                    {c.nameZh ?? c.nameEn}
                  </span>
                  {c.nameZh && <span className="text-base leading-tight whitespace-nowrap">{c.nameEn}</span>}
                </button>
              );
            })}
          </nav>
          <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-auto sm:min-w-48 sm:flex-1">
            <Icon name="search" size={20} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-staff-faint" />
            {/* type="text", not "search": the browser's own clear glyph is tiny
                and doubled up with the 48px one beside it. */}
            <input
              type="text"
              inputMode="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("pos.search")}
              aria-label={t("pos.search")}
              enterKeyHint="search"
              className={`${field} pr-12 pl-10 text-lg`}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={t("pos.searchClear")}
                className="absolute top-0 right-0 flex h-12 w-12 items-center justify-center text-staff-faint hover:text-staff-ink"
              >
                <Icon name="x" size={20} />
              </button>
            )}
          </div>
          {lunchCategoryIds.size > 0 && !lunchNow && (
            <button
              type="button"
              aria-pressed={lunchOverride}
              title={t("pos.lunchOverrideHint")}
              onClick={() => setLunchOverride((v) => !v)}
              className={`flex min-h-12 items-center gap-2.5 rounded-md border px-3 text-base font-medium transition-colors ${
                lunchOverride
                  ? "border-staff-warn bg-staff-warn-tint text-staff-warn"
                  : "border-staff-line-strong bg-staff-panel text-staff-soft hover:text-staff-ink"
              }`}
            >
              <span
                aria-hidden="true"
                className={`relative h-5 w-9 rounded-full transition-colors ${lunchOverride ? "bg-staff-warn" : "bg-staff-line-strong"}`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-[left] ${lunchOverride ? "left-[1.125rem]" : "left-0.5"}`}
                />
              </span>
              {t("pos.lunchOverride")}
            </button>
          )}
          {/* Inside the sticky bar, so the warning stays on screen for as
              long as the override does, however far the dishes scroll. */}
          {lunchOverride && !lunchNow && (
            <p role="status" className="flex w-full items-center gap-2 rounded-md bg-staff-warn-tint px-3 py-2 text-base font-medium text-staff-warn">
              <Icon name="alert" size={18} />
              {t("pos.lunchOverrideWarning", lunchLabel)}
            </p>
          )}
          </div>
        </div>

        {results ? (
          <div className="px-3 pb-6">
            <h2 className="mt-2 mb-2 text-base font-semibold text-staff-soft">{t("pos.results")}</h2>
            {results.length === 0 ? (
              <p className="py-16 text-center text-lg text-staff-faint">{t("pos.noResults", { q: query.trim() })}</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{results.map(itemCard)}</div>
            )}
          </div>
        ) : (
          menu.categories.map((c) => (
            <section key={c.id} id={`pos-cat-${c.id}`} className="scroll-mt-48 px-3 pt-4 pb-2">
              <h2 className="mb-3 flex flex-wrap items-baseline gap-x-3">
                <span className="text-2xl font-bold">{c.nameZh ?? c.nameEn}</span>
                {c.nameZh && <span className="text-lg">{c.nameEn}</span>}
                {lunchCategoryIds.has(c.id) && (
                  <span className="text-base text-staff-faint">· {t("pos.lunchWindow", lunchLabel)}</span>
                )}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{c.items.map(itemCard)}</div>
            </section>
          ))
        )}
      </section>

      {/* ---------------------------------------------------------- ticket -- */}
      <aside
        ref={ticketPaneRef}
        aria-label={t("pos.ticket")}
        className="flex min-w-0 flex-col border-t border-staff-line bg-staff-panel md:overflow-y-auto md:border-t-0 md:border-l"
      >
        <div className="flex-1 p-4">
          {/* 桌 4 · 3 位: the table, at the top, as large as the order number.
              Tap to change (or to seat one). */}
          {mode === "dine_in" && (
            <button
              type="button"
              data-seating={seating?.label ?? ""}
              onClick={() => setFloorOpen(true)}
              className={`mb-4 flex w-full flex-col items-start gap-1 rounded-xl px-4 py-3 text-left transition-colors ${
                seating
                  ? "bg-staff-ink text-staff-panel hover:bg-staff-soft"
                  : "border-4 border-dashed border-staff-ink bg-staff-panel text-staff-ink hover:bg-staff-sunken"
              }`}
            >
              {seating ? (
                <>
                  {seating.addon && (
                    <span className="rounded-md bg-staff-panel px-2 text-xl font-bold text-staff-ink">
                      {t("ticket.addon")}
                    </span>
                  )}
                  <span lang="zh-Hant" className="text-4xl leading-tight font-bold">
                    {t("pos.table.summaryZh", { table: seating.label, guests: seating.guests })}
                  </span>
                  <span lang="en" className="text-2xl leading-tight font-bold">
                    {t("pos.table.summaryEn", { table: seating.label, guests: seating.guests })}
                  </span>
                  <span className="text-base">{t("pos.table.change")}</span>
                </>
              ) : (
                <span className="flex min-h-14 items-center gap-3 text-3xl font-bold">
                  <Icon name="table" size={32} />
                  {t("pos.table.choose")}
                </span>
              )}
            </button>
          )}

          {placed && (
            <div role="status" className="mb-4 flex items-center gap-4 rounded-lg bg-staff-accent-tint px-4 py-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-staff-accent text-white">
                <Icon name="check" size={22} />
              </span>
              <span className="min-w-0">
                <span className="block text-4xl leading-none font-semibold tracking-tight text-staff-accent">{placed.orderNumber}</span>
                <span className="mt-1 block text-base font-medium text-staff-soft">
                  {t("pos.sent")} · {formatCents(placed.totalCents)}
                </span>
              </span>
            </div>
          )}

          {justNow && !placed && (
            <div className="mb-4 flex items-center justify-between gap-2 rounded-md bg-staff-sunken py-1 pr-1 pl-3">
              <span className="text-base text-staff-soft">
                {t("pos.justNow")} <span className="ml-1 text-base font-semibold text-staff-ink">{justNow.orderNumber}</span>
              </span>
              <button
                type="button"
                onClick={() => reprint(justNow)}
                className="flex min-h-12 items-center gap-2 rounded-md px-3 text-base font-medium text-staff-ink hover:bg-staff-panel"
              >
                <Icon name="printer" size={18} />
                {t("pos.reprint")}
              </button>
            </div>
          )}
          {justNow && placed && (
            <div className="-mt-2 mb-4 flex justify-end">
              <button
                type="button"
                onClick={() => reprint(justNow)}
                className="flex min-h-12 items-center gap-2 rounded-md px-3 text-base font-medium text-staff-soft hover:bg-staff-sunken hover:text-staff-ink"
              >
                <Icon name="printer" size={18} />
                {t("pos.reprint")}
              </button>
            </div>
          )}

          {notice && (
            <p role="status" className="mb-4 rounded-md bg-staff-sunken px-3 py-2 text-base text-staff-soft">
              {notice}
            </p>
          )}

          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">{t("pos.ticket")}</h2>
            {itemCount > 0 && <span className="text-base text-staff-faint">{t("pos.itemCount", { n: itemCount })}</span>}
          </div>
          {lines.length === 0 ? (
            <p className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-staff-line-strong px-3 text-center text-base text-staff-faint">
              {t("pos.ticketEmpty")}
            </p>
          ) : (
            <ul className="divide-y divide-staff-line rounded-md border border-staff-line">
              {priced.map(({ line, item, lineCents }) => {
                const size = item ? itemSizes(item).find((s) => s.id === line.sizeId) : undefined;
                const mods = item
                  ? item.modifierGroups.flatMap((g) => g.modifiers).filter((m) => line.modifierIds.includes(m.id))
                  : [];
                return (
                  <li key={line.lineId} className="px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <DishName nameZh={item?.nameZh ?? null} nameEn={item?.nameEn ?? line.itemId} size="sm" />
                      <span className="shrink-0 text-lg font-bold">{formatCents(lineCents)}</span>
                    </div>
                    {size && !isDefaultSize(size.label) && (
                      <span className="mt-1 inline-flex gap-1.5 rounded-sm bg-staff-accent-tint px-1.5 py-0.5 text-base font-semibold text-staff-accent">
                        {resolveSizeZh(size.label) ?? size.label} <span className="font-normal">{size.label}</span>
                      </span>
                    )}
                    {mods.map((m) => (
                      <div key={m.id} className="text-base text-staff-soft">
                        {m.nameZh ?? m.nameEn} {m.nameZh && <span className="text-staff-faint">{m.nameEn}</span>}
                      </div>
                    ))}
                    {line.specialInstructions && (
                      <div className="mt-1 rounded-sm bg-staff-warn-tint px-2 py-1 text-base text-staff-warn">
                        {t("pos.lineNote", { note: line.specialInstructions })}
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center overflow-hidden rounded-md border border-staff-line-strong">
                        <button type="button" aria-label={t("pos.decrease")} onClick={() => setQty(line.lineId, line.quantity - 1)} className={stepper}>
                          <Icon name="minus" size={18} />
                        </button>
                        <span className="w-14 text-center text-2xl font-bold">{line.quantity}</span>
                        <button type="button" aria-label={t("pos.increase")} onClick={() => setQty(line.lineId, line.quantity + 1)} className={stepper}>
                          <Icon name="plus" size={18} />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setQty(line.lineId, 0)}
                        className="min-h-12 rounded-md px-3 text-base font-medium text-staff-faint hover:bg-staff-danger-tint hover:text-staff-danger"
                      >
                        {t("pos.remove")}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* ------------------------------------------------- customer -- */}
          <div className="mt-6 flex flex-col gap-4 border-t border-staff-line pt-5">
            {mode === "takeout" && (
              <>
                <div role="group" aria-label={t("pos.takeoutKind")} className="grid grid-cols-2 gap-1 rounded-xl bg-staff-sunken p-1">
                  {(["phone", "walk_in"] as const).map((c) => (
                    <button key={c} type="button" data-channel={c} aria-pressed={channel === c} onClick={() => setChannel(c)} className={segment(channel === c)}>
                      <Icon name={c === "phone" ? "phone" : "store"} size={24} />
                      {t(`channel.${c}`)}
                    </button>
                  ))}
                </div>

                <label>
                  <span className={label}>{t("pos.customerName")}</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" className={`${field} text-lg`} />
                </label>

                <label>
                  <span className={label}>{channel === "phone" ? t("pos.phone") : t("pos.phoneOptional")}</span>
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    value={phone}
                    onChange={(e) => setPhone(formatPhoneAsTyped(e.target.value))}
                    aria-invalid={phoneBad}
                    className={`${field} text-lg ${phoneBad ? "border-staff-danger" : ""}`}
                  />
                  {phoneBad && <span className="mt-1 block text-base font-medium text-staff-danger">{t("pos.phoneInvalid")}</span>}
                </label>

                {returningHere && (
                  <div className="rounded-md border border-staff-line bg-staff-bg p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-base">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-staff-blue-tint text-staff-blue">
                          <Icon name="user" size={15} />
                        </span>
                        <span>
                          <span className="text-staff-faint">{t("pos.returning")}</span>{" "}
                          <span className="font-semibold text-staff-ink">{returningHere.name}</span>
                        </span>
                      </span>
                      {returningHere.name && name.trim() !== returningHere.name && (
                        <button
                          type="button"
                          onClick={() => setName(returningHere.name ?? "")}
                          className="min-h-12 rounded-md px-3 text-base font-semibold text-staff-accent hover:bg-staff-accent-tint"
                        >
                          {t("pos.useName")}
                        </button>
                      )}
                    </div>
                    <div className="mt-2 text-base font-medium text-staff-faint">{t("pos.recentOrders")}</div>
                    <ul className="mt-1.5 flex flex-col gap-1.5">
                      {returningHere.orders.map((o) => (
                        <li key={o.id} className="flex items-center justify-between gap-2 rounded-md bg-staff-panel py-1.5 pr-1.5 pl-3">
                          <span className="min-w-0 text-base">
                            <span className="block text-staff-faint">
                              {o.businessDate} · {o.orderNumber} · {formatCents(o.totalCents)}
                            </span>
                            <span lang="zh-Hant" className="block truncate font-medium text-staff-ink">
                              {o.items.map((l) => `${l.quantity}× ${l.nameZh ?? l.nameEn}`).join("、")}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => reorder(o)}
                            className="flex min-h-12 shrink-0 items-center gap-1.5 rounded-md border border-staff-accent px-3 text-base font-semibold text-staff-accent hover:bg-staff-accent-tint"
                          >
                            <Icon name="repeat" size={16} />
                            {t("pos.reorder")}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <label>
                  <span className={label}>{t("pos.pickup")}</span>
                  <select value={pickupValue} onChange={(e) => setPickup(e.target.value)} className={field} disabled={slots.length === 0}>
                    {slots.length === 0 && <option value="">{now ? t("pos.noSlots") : t("common.loading")}</option>}
                    {slots.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.value === "asap" ? t("pos.asap", { n: pickupOptions.leadMinutes }) : s.label}
                      </option>
                    ))}
                  </select>
                </label>

              </>
            )}

            <label>
              <span className={label}>{t("pos.paymentNote")}</span>
              <input
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
                maxLength={200}
                placeholder={t("pos.paymentNotePlaceholder")}
                autoComplete="off"
                className={field}
              />
            </label>

            <label>
              <span className={label}>{t("pos.staffNote")}</span>
              <textarea
                value={staffNote}
                onChange={(e) => setStaffNote(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder={t("pos.staffNotePlaceholder")}
                className={`${field} resize-none py-2`}
              />
            </label>
          </div>
        </div>

        {/* ------------------------------------------------- totals + print -- */}
        <div className="sticky bottom-0 border-t border-staff-line bg-staff-panel p-4">
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-base text-staff-soft">
            <dt>{t("pos.subtotal")}</dt>
            <dd className="text-right">{formatCents(subtotal)}</dd>
            <dt>{t("pos.tax")}</dt>
            <dd className="text-right">{formatCents(tax)}</dd>
            <dt className="mt-1 text-2xl font-bold text-staff-ink">{t("pos.total")}</dt>
            <dd className="mt-1 text-right text-2xl font-bold text-staff-ink">{formatCents(total)}</dd>
          </dl>
          <div className="text-base text-staff-faint">{t("pos.payAtCounter")}</div>

          {error && (
            <p role="alert" className="mt-3 flex items-start gap-2 rounded-md bg-staff-danger-tint px-3 py-2 text-base font-medium text-staff-danger">
              <Icon name="alert" size={18} className="mt-px" />
              {error}
            </p>
          )}
          {!error && missing.length > 0 && lines.length > 0 && (
            <p className="mt-2 text-base text-staff-faint">{missing.map((k) => t(k)).join(" · ")}</p>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              data-action="print"
              className="flex min-h-16 flex-1 items-center justify-center gap-3 rounded-xl bg-staff-accent px-4 text-2xl font-bold text-white transition-colors hover:bg-staff-accent-hover disabled:cursor-not-allowed disabled:bg-staff-sunken disabled:text-staff-soft"
            >
              <Icon name="printer" size={28} />
              {submitting ? t("pos.printing") : t("pos.print")}
            </button>
            <button
              type="button"
              onClick={() => {
                if (lines.length === 0 || clearArmed) {
                  resetTicket();
                  setPlaced(null);
                  setError(null);
                } else {
                  setClearArmed(true);
                }
              }}
              className={`min-h-16 rounded-xl px-4 text-lg font-semibold transition-colors ${
                clearArmed
                  ? "bg-staff-danger text-white"
                  : "border-2 border-staff-line-strong text-staff-ink hover:bg-staff-sunken"
              }`}
            >
              {clearArmed ? t("pos.clearConfirm") : t("pos.clear")}
            </button>
          </div>
        </div>
      </aside>

      {/* Phones only: the panes stack, so the ticket is a long scroll below
          the menu. A sticky bar keeps the count and total in view and jumps
          to it. Tablets see the ticket pane all the time and never get this. */}
      {lines.length > 0 && (
        <button
          type="button"
          onClick={() => ticketPaneRef.current?.scrollIntoView({ block: "start" })}
          className="sticky bottom-0 z-20 flex min-h-14 items-center justify-between gap-3 bg-staff-accent px-4 text-base font-semibold text-white md:hidden"
        >
          <span>{t("pos.viewTicket", { n: itemCount })}</span>
          <span>{formatCents(total)}</span>
        </button>
      )}

      {floorOpen && (
        <FloorPlanSheet
          onClose={() => setFloorOpen(false)}
          onSeat={(next) => {
            setSeating(next);
            setMode("dine_in");
            setFloorOpen(false);
            setError(null);
            setPlaced(null);
          }}
          onCleared={(label) => {
            if (seating?.label === label) setSeating(null);
          }}
        />
      )}

      {sheetItem && (
        <StaffItemSheet
          key={sheetItem.id}
          item={sheetItem}
          menuNumber={menuNumber(sheetItem.id)}
          onAdd={addLine}
          onClose={() => setSheetItem(null)}
        />
      )}
    </main>
  );
}
