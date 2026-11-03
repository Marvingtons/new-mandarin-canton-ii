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
import PosTopBar from "@/components/kitchen/PosTopBar";
import type { KitchenKey } from "@/lib/kitchen/i18n";

/**
 * Staff order entry: a phone call, a walk-in, or a table, tapped in and printed.
 *
 * THIS SCREEN PRICES NOTHING. The totals it shows are resolveLinePrice and
 * taxCents, the same pure functions the server uses, purely so staff can quote
 * the caller a number; the order that prints is the one POST /api/kitchen/orders
 * recomputes from the menu. The request carries no money at all.
 *
 * A TILL, NOT A PAGE. Four fixed zones and nothing scrolls but the dishes and
 * the ticket's lines: a 72px top bar (外賣 / 堂食, the context chip, tools), a
 * full-height category rail, the dish grid, and the ticket with its total and
 * Print pinned at the bottom. In portrait the ticket moves under the dishes.
 * Zones and columns are in globals.css (THE POS).
 *
 * TWO SERVICES, ONE SCREEN. Takeout asks phone or walk-in, then who and when,
 * in a sheet opened from the context chip; dine-in asks only which table and
 * how many (the floor plan sheet), and the chip reads 桌 4 · 3 位. The dishes
 * and the Print button are the same for both, and so is the order route: one
 * pipeline (see POST /api/kitchen/orders).
 *
 * READ AT ARM'S LENGTH. The people using this include older staff with poor
 * eyesight. Dish 中文 is the largest type on a card, prices are bold, there are
 * no descriptions and no pale captions, nothing is under 22px, and every
 * control is at least 56px, Print 88px (globals.css sets the staff type
 * scale; 大字 scales it again, and the grid drops a column rather than
 * squeezing names).
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
  /** The dish being chosen, and the size its tap zone asked for (a tray). */
  const [sheetItem, setSheetItem] = useState<{ item: MenuItem; sizeId?: string } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>(menu.categories[0]?.id ?? "");

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
    setSearchOpen(false);
    setActiveCategory(category.id);
    // After the search results unmount, so the section is in the DOM.
    requestAnimationFrame(() => {
      document.getElementById(`pos-cat-${category.id}`)?.scrollIntoView({ block: "start" });
    });
  }

  function openItem(item: MenuItem, sizeId?: string) {
    setSheetItem({ item, sizeId });
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
      setSearchOpen(false);
      setDetailsOpen(false);
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
  /** How many of each dish are on the ticket, for the +N on its card. */
  const onTicket = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of lines) counts.set(l.itemId, (counts.get(l.itemId) ?? 0) + l.quantity);
    return counts;
  }, [lines]);

  const itemCard = (item: MenuItem) => {
    const num = menuNumber(item.id);
    const sizes = itemSizes(item);
    const tray = sizes.find((s) => s.id === "party-tray");
    const eightySixed = !isAvailable(item);
    const lunchLocked = item.lunchSpecial === true && !lunchOpen;
    const disabled = eightySixed || lunchLocked;
    const count = onTicket.get(item.id) ?? 0;
    // 中文, English, price. No description: read at arm's length, a card is
    // a name to recognise, not a paragraph to read. The main card is the
    // regular size; a tray is its own tap zone, so it is never a second step.
    return (
      <div
        key={item.id}
        className={`relative flex flex-col rounded-pos ${disabled ? "bg-pos-sunken" : "bg-pos-card shadow-pos-card"}`}
      >
        <button
          type="button"
          onClick={() => openItem(item)}
          disabled={disabled}
          data-item={item.id}
          className="pos-press flex min-h-[6.5rem] flex-1 flex-col gap-2 rounded-pos p-3.5 text-left disabled:cursor-not-allowed"
        >
          <span className="flex min-w-0 flex-col">
            <span lang={item.nameZh ? "zh-Hant" : "en"} className="text-[1.273rem] leading-snug font-semibold text-balance">
              {item.nameZh ?? item.nameEn}
            </span>
            {item.nameZh && (
              <span lang="en" className="text-base leading-snug text-pos-muted">
                {item.nameEn}
              </span>
            )}
          </span>
          <span className="mt-auto flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-[1.091rem] font-bold tabular-nums">{formatCents(sizes[0].priceCents)}</span>
            {num !== null && <span className="text-base text-pos-muted tabular-nums">{t("pos.dish.number", { n: num })}</span>}
          </span>
          {eightySixed && (
            <span className="self-start rounded-full bg-pos-brand px-3 text-base font-bold text-white">{t("pos.86d")}</span>
          )}
          {!eightySixed && lunchLocked && (
            <span className="self-start rounded-full bg-pos-card px-3 text-base font-semibold">{t("pos.lunchClosed")}</span>
          )}
        </button>
        {tray && !disabled && (
          <button
            type="button"
            onClick={() => openItem(item, tray.id)}
            className="pos-press mx-2 mb-2 flex min-h-[2.545rem] flex-wrap items-center justify-between gap-x-2 rounded-xl bg-pos-sunken px-3 py-1 text-left text-base font-semibold hover:bg-pos-gold-tint"
          >
            <span>{t("pos.tray")}</span>
            <span className="font-bold tabular-nums">{formatCents(tray.priceCents)}</span>
          </button>
        )}
        {count > 0 && (
          <span
            key={count}
            title={t("pos.onTicket", { n: count })}
            className="pos-pop pointer-events-none absolute -top-2 -right-2 flex h-[2.182rem] min-w-[2.182rem] items-center justify-center rounded-full bg-pos-added px-2 text-base font-bold text-white tabular-nums shadow-pos-card"
          >
            +{count}
          </span>
        )}
      </div>
    );
  };

  const field =
    "min-h-[3rem] w-full rounded-xl bg-pos-card px-4 text-[1.091rem] text-pos-ink shadow-[inset_0_0_0_2px_var(--color-pos-sunken)] outline-none placeholder:text-pos-muted focus:shadow-[inset_0_0_0_2px_var(--color-pos-brand)]";
  const label = "mb-2 block text-base font-semibold text-pos-ink";
  const stepper =
    "flex h-[2.545rem] w-[2.545rem] items-center justify-center rounded-full bg-pos-sunken text-pos-ink transition-colors hover:bg-pos-gold-tint active:bg-pos-gold-tint";
  const itemCount = lines.reduce((n, l) => n + l.quantity, 0);
  const takeoutMissing = mode === "takeout" && (missing.includes("pos.missing.name") || missing.includes("pos.missing.phone"));
  const customerSummary = [name.trim(), phone.trim()].filter(Boolean).join(" · ");

  /* The chip in the middle of the top bar: who this order is for. */
  const chip = "flex h-[2.545rem] max-w-full min-w-0 items-center gap-2.5 rounded-xl px-3.5 text-base font-semibold whitespace-nowrap transition-colors";
  const contextChip =
    mode === "dine_in" ? (
      // 桌 4 · 3 位. Tap to change table (or to seat one).
      <button
        type="button"
        data-seating={seating?.label ?? ""}
        onClick={() => setFloorOpen(true)}
        className={`${chip} ${
          seating ? "bg-pos-card text-pos-ink shadow-pos-card" : "bg-pos-brand-tint text-pos-brand"
        }`}
      >
        <Icon name="table" size={20} className={seating ? "text-pos-muted" : ""} />
        {seating ? (
          <span className="flex min-w-0 items-center gap-2.5 truncate">
            {seating.addon && (
              <span className="shrink-0 rounded-lg bg-pos-gold-tint px-2 font-bold">{t("ticket.addon")}</span>
            )}
            <span lang="zh-Hant" className="text-[1.182rem] font-bold whitespace-nowrap">
              {t("pos.table.summaryZh", { table: seating.label, guests: seating.guests })}
            </span>
          </span>
        ) : (
          <span>{t("pos.table.choose")}</span>
        )}
      </button>
    ) : (
      <button
        type="button"
        data-context="takeout"
        onClick={() => setDetailsOpen(true)}
        aria-label={t("pos.details.open", { summary: customerSummary || t(`channel.${channel}`) })}
        className={`${chip} ${
          takeoutMissing && lines.length > 0 ? "bg-pos-brand-tint text-pos-brand" : "bg-pos-card text-pos-ink shadow-pos-card"
        }`}
      >
        <Icon name={channel === "phone" ? "phone" : "store"} size={20} className="opacity-80" />
        {name.trim() || phone.trim() ? (
          // The name first and whole; the phone only where the bar has room.
          <span className="flex min-w-0 items-baseline gap-2">
            {name.trim() && <span className="min-w-0 truncate">{name.trim()}</span>}
            {phone.trim() && (
              <span className={`font-normal tabular-nums ${name.trim() ? "hidden text-pos-muted @min-[17rem]/chip:inline" : ""}`}>
                {phone.trim()}
              </span>
            )}
          </span>
        ) : (
          <span>{t("pos.details.add")}</span>
        )}
      </button>
    );

  const searchField = (
    <div className="relative w-full max-w-[24rem]">
      <Icon name="search" size={20} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-pos-muted" />
      {/* type="text", not "search": the browser's own clear glyph is tiny
          and doubled up with the 56px one beside it. */}
      <input
        type="text"
        inputMode="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("pos.search")}
        aria-label={t("pos.search")}
        enterKeyHint="search"
        autoFocus
        className={`${field} h-[2.545rem] min-h-0 pr-14 pl-12 text-base`}
      />
      <button
        type="button"
        onClick={() => {
          setQuery("");
          setSearchOpen(false);
        }}
        aria-label={t("pos.searchClose")}
        className="absolute top-0 right-0 flex h-[2.545rem] w-[2.545rem] items-center justify-center rounded-xl text-pos-muted hover:text-pos-ink"
      >
        <Icon name="x" size={20} />
      </button>
    </div>
  );

  const lunchChip =
    lunchCategoryIds.size > 0 && !lunchNow ? (
      <button
        type="button"
        aria-pressed={lunchOverride}
        title={t("pos.lunchOverrideHint")}
        aria-label={t("pos.lunchOverride")}
        onClick={() => setLunchOverride((v) => !v)}
        className={`flex h-[2.545rem] items-center gap-2 rounded-xl px-3 text-base font-semibold whitespace-nowrap transition-colors ${
          lunchOverride ? "bg-pos-gold-tint text-pos-ink" : "text-pos-muted hover:bg-pos-sunken hover:text-pos-ink"
        }`}
      >
        <span
          aria-hidden="true"
          className={`relative h-[1.091rem] w-[1.909rem] rounded-full transition-colors ${lunchOverride ? "bg-pos-gold" : "bg-pos-sunken shadow-[inset_0_0_0_2px_var(--color-pos-muted)]"}`}
        >
          <span
            className={`absolute top-[0.136rem] h-[0.818rem] w-[0.818rem] rounded-full transition-[left] ${
              lunchOverride ? "left-[0.955rem] bg-white" : "left-[0.136rem] bg-pos-muted"
            }`}
          />
        </span>
        {t("pos.lunchChip")}
      </button>
    ) : null;

  return (
    <main className="pos-root grid h-svh overflow-hidden bg-pos-bg text-pos-ink">
      <PosTopBar
        mode={mode}
        onMode={(m) => {
          setMode(m);
          setError(null);
          // Straight to the floor plan: a dine-in order starts at a table.
          if (m === "dine_in" && !seating) setFloorOpen(true);
        }}
        context={searchOpen ? searchField : contextChip}
        search={searchOpen ? null : () => setSearchOpen(true)}
        lunch={lunchChip}
      />

      {/* ---------------------------------------------------- categories -- */}
      {/* Full height, one column: 中文 large, English under it, the current
          one filled in the brand red. Scrolls only if the room runs out. */}
      <nav
        aria-label={t("pos.categories")}
        className="flex min-h-0 flex-col overflow-y-auto px-1.5 pb-5 [grid-area:rail] [mask-image:linear-gradient(to_bottom,black_calc(100%-1.25rem),transparent)]"
      >
        {menu.categories.map((c) => {
          const on = activeCategory === c.id && !results;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => jumpTo(c)}
              aria-current={on ? "true" : undefined}
              className={`flex min-h-[2.545rem] shrink-0 grow flex-col justify-center rounded-xl px-2.5 text-left transition-colors ${
                on ? "bg-pos-brand text-white" : "text-pos-ink hover:bg-pos-sunken"
              }`}
            >
              <span lang={c.nameZh ? "zh-Hant" : "en"} className="text-[1.091rem] leading-[1.05] font-bold">
                {c.nameZh ?? c.nameEn}
              </span>
              {c.nameZh && (
                <span lang="en" className={`text-base leading-[1.05] ${on ? "text-white/90" : "text-pos-muted"}`}>
                  {c.nameEn}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* --------------------------------------------------------- dishes -- */}
      <section ref={dishPaneRef} aria-label={t("pos.title")} className="pos-dishes min-h-0 min-w-0 overflow-y-auto [grid-area:dishes]">
        {/* Inside the scroller and sticky, so the warning stays on screen for
            as long as the override does, however far the dishes scroll. */}
        {lunchOverride && !lunchNow && (
          <p role="status" className="sticky top-0 z-10 mx-[var(--pos-gap)] mt-1 flex items-center gap-3 rounded-xl bg-pos-gold-tint px-4 py-2 text-base font-medium">
            <Icon name="alert" size={18} className="shrink-0" />
            {t("pos.lunchOverrideWarning", lunchLabel)}
          </p>
        )}

        {results ? (
          <div className="px-[var(--pos-gap)] pt-2 pb-8">
            <h2 className="mb-3 text-base font-semibold text-pos-muted">{t("pos.results")}</h2>
            {results.length === 0 ? (
              <p className="py-16 text-center text-[1.091rem] text-pos-muted">{t("pos.noResults", { q: query.trim() })}</p>
            ) : (
              <div className="pos-grid">{results.map(itemCard)}</div>
            )}
          </div>
        ) : (
          menu.categories.map((c) => (
            <section key={c.id} id={`pos-cat-${c.id}`} className="scroll-mt-2 px-[var(--pos-gap)] pt-2 pb-6">
              <h2 className="mb-3 flex flex-wrap items-baseline gap-x-3">
                <span lang={c.nameZh ? "zh-Hant" : "en"} className="text-[1.273rem] font-bold">
                  {c.nameZh ?? c.nameEn}
                </span>
                {c.nameZh && <span className="text-base text-pos-muted">{c.nameEn}</span>}
                {lunchCategoryIds.has(c.id) && (
                  <span className="text-base text-pos-muted">· {t("pos.lunchWindow", lunchLabel)}</span>
                )}
              </h2>
              <div className="pos-grid">{c.items.map(itemCard)}</div>
            </section>
          ))
        )}
      </section>

      {/* ---------------------------------------------------------- ticket -- */}
      <aside aria-label={t("pos.ticket")} className="pos-ticket min-h-0 min-w-0 bg-pos-card [grid-area:ticket]">
        <div className="flex min-h-0 flex-col">
          <div className="flex flex-col gap-3 px-5 pt-4">
            {placed && (
              <div role="status" className="flex items-center gap-4 rounded-pos bg-pos-added-tint px-4 py-3">
                <span className="flex h-[2.182rem] w-[2.182rem] shrink-0 items-center justify-center rounded-full bg-pos-added text-white">
                  <Icon name="check" size={20} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[1.636rem] leading-none font-bold tracking-tight text-pos-added tabular-nums">
                    {placed.orderNumber}
                  </span>
                  <span className="mt-1 block text-base text-pos-muted">
                    {t("pos.sent")} · {formatCents(placed.totalCents)}
                  </span>
                </span>
              </div>
            )}
            {justNow && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-base text-pos-muted">
                  {!placed && (
                    <>
                      {t("pos.justNow")} <span className="font-semibold text-pos-ink tabular-nums">{justNow.orderNumber}</span>
                    </>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => reprint(justNow)}
                  className="flex min-h-[2.545rem] items-center gap-2 rounded-xl px-3 text-base font-semibold text-pos-ink hover:bg-pos-sunken"
                >
                  <Icon name="printer" size={18} />
                  {t("pos.reprint")}
                </button>
              </div>
            )}
            {notice && (
              <p role="status" className="rounded-xl bg-pos-sunken px-4 py-2 text-base">
                {notice}
              </p>
            )}
            <div className="flex items-baseline justify-between">
              <h2 className="text-[1.091rem] font-bold">{t("pos.ticket")}</h2>
              {itemCount > 0 && <span className="text-base text-pos-muted tabular-nums">{t("pos.itemCount", { n: itemCount })}</span>}
            </div>
          </div>

          {lines.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-8 text-center text-pos-muted">
              <Icon name="receipt" size={36} className="text-pos-gold" />
              <p className="flex flex-col">
                <span lang="zh-Hant" className="text-[1.091rem] font-semibold">{t("pos.ticketEmptyZh")}</span>
                <span lang="en" className="text-base">{t("pos.ticketEmptyEn")}</span>
              </p>
            </div>
          ) : (
            <ul className="min-h-0 flex-1 divide-y-2 divide-pos-bg overflow-y-auto px-5 pb-2">
              {priced.map(({ line, item, lineCents }) => {
                const size = item ? itemSizes(item).find((s) => s.id === line.sizeId) : undefined;
                const mods = item
                  ? item.modifierGroups.flatMap((g) => g.modifiers).filter((m) => line.modifierIds.includes(m.id))
                  : [];
                return (
                  <li key={line.lineId} className="py-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <DishName nameZh={item?.nameZh ?? null} nameEn={item?.nameEn ?? line.itemId} size="sm" className="pt-1" />
                      <button
                        type="button"
                        aria-label={t("pos.remove")}
                        onClick={() => setQty(line.lineId, 0)}
                        className="-mr-2 flex h-[2.545rem] w-[2.545rem] shrink-0 items-center justify-center rounded-full text-pos-muted transition-colors hover:bg-pos-brand-tint hover:text-pos-brand"
                      >
                        <Icon name="x" size={20} />
                      </button>
                    </div>
                    {size && !isDefaultSize(size.label) && (
                      <span className="mt-1 inline-flex gap-1.5 rounded-lg bg-pos-gold-tint px-2 text-base font-semibold">
                        {resolveSizeZh(size.label) ?? size.label} <span className="font-normal">{size.label}</span>
                      </span>
                    )}
                    {mods.map((m) => (
                      <div key={m.id} className="text-base text-pos-muted">
                        {m.nameZh ?? m.nameEn} {m.nameZh && <span>{m.nameEn}</span>}
                      </div>
                    ))}
                    {line.specialInstructions && (
                      <div className="mt-1 rounded-lg bg-pos-gold-tint px-2 py-0.5 text-base">
                        {t("pos.lineNote", { note: line.specialInstructions })}
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1">
                        <button type="button" aria-label={t("pos.decrease")} onClick={() => setQty(line.lineId, line.quantity - 1)} className={stepper}>
                          <Icon name="minus" size={22} />
                        </button>
                        <span className="w-[2.364rem] text-center text-[1.364rem] font-bold tabular-nums">{line.quantity}</span>
                        <button type="button" aria-label={t("pos.increase")} onClick={() => setQty(line.lineId, line.quantity + 1)} className={stepper}>
                          <Icon name="plus" size={22} />
                        </button>
                      </div>
                      <span className="text-[1.091rem] font-bold tabular-nums">{formatCents(lineCents)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ------------------------------------------------- totals + print -- */}
        <div className="flex flex-col justify-end px-5 pt-3 pb-4 shadow-[0_-1px_0_var(--color-pos-sunken)] portrait:shadow-[-1px_0_0_var(--color-pos-sunken)]">
          {/* Subtotal and tax share a line: the room is the ticket's. */}
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 text-base text-pos-muted tabular-nums">
            <div className="col-span-2 flex flex-wrap justify-between gap-x-4">
              <span className="flex gap-2">
                <dt>{t("pos.subtotal")}</dt>
                <dd>{formatCents(subtotal)}</dd>
              </span>
              <span className="flex gap-2">
                <dt>{t("pos.tax")}</dt>
                <dd>{formatCents(tax)}</dd>
              </span>
            </div>
            <dt className="mt-1 flex items-baseline gap-3 text-[1.455rem] font-bold text-pos-ink">
              {t("pos.total")}
              <span className="text-base font-normal text-pos-muted">{t("pos.payAtCounter")}</span>
            </dt>
            <dd className="mt-1 text-right text-[1.455rem] font-bold text-pos-ink">{formatCents(total)}</dd>
          </dl>

          {error && (
            <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-pos-brand-tint px-3 py-2 text-base font-medium text-pos-brand">
              <Icon name="alert" size={18} className="mt-1" />
              {error}
            </p>
          )}
          {!error && missing.length > 0 && lines.length > 0 && (
            <p className="mt-2 text-base text-pos-brand">{missing.map((k) => t(k)).join(" · ")}</p>
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              className="flex min-h-[2.545rem] items-center gap-2 rounded-xl px-2 text-base font-semibold text-pos-muted hover:bg-pos-sunken hover:text-pos-ink"
            >
              <Icon name="note" size={18} />
              {t("pos.notes")}
              {(paymentNote.trim() || staffNote.trim()) && <span aria-hidden="true" className="h-2 w-2 rounded-full bg-pos-gold" />}
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
              className={`min-h-[2.545rem] rounded-xl px-3 text-base font-semibold transition-colors ${
                clearArmed ? "bg-pos-brand-tint text-pos-brand" : "text-pos-muted hover:bg-pos-sunken hover:text-pos-ink"
              }`}
            >
              {clearArmed ? t("pos.clearConfirm") : t("pos.clear")}
            </button>
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-action="print"
            className="mt-2 flex h-[4rem] w-full items-center justify-center gap-3 rounded-pos bg-pos-brand px-4 text-[1.364rem] font-bold whitespace-nowrap text-white tabular-nums transition-colors hover:bg-pos-brand-hover disabled:cursor-not-allowed disabled:bg-pos-sunken disabled:text-pos-muted"
          >
            <Icon name="printer" size={24} />
            {submitting ? t("pos.printing") : t("pos.printTotal", { total: formatCents(total) })}
          </button>
        </div>
      </aside>

      {/* --------------------------------------- customer details + notes -- */}
      {detailsOpen && (
        <div role="dialog" aria-modal="true" aria-label={mode === "takeout" ? t("pos.details.title") : t("pos.notesTitle")} className="fixed inset-0 z-50 flex justify-end">
          <button aria-hidden="true" tabIndex={-1} className="absolute inset-0 bg-pos-scrim" onClick={() => setDetailsOpen(false)} />
          <div className="pos-sheet-in relative z-10 flex h-full w-full max-w-[26rem] flex-col bg-pos-bg shadow-pos-raised">
            <div className="flex h-[var(--pos-top)] shrink-0 items-center justify-between gap-4 px-6">
              <h2 className="text-[1.273rem] font-bold">{mode === "takeout" ? t("pos.details.title") : t("pos.notesTitle")}</h2>
              <button
                type="button"
                data-action="details-done"
                onClick={() => setDetailsOpen(false)}
                className="flex h-[2.545rem] items-center rounded-xl bg-pos-brand px-5 text-base font-bold text-white hover:bg-pos-brand-hover"
              >
                {t("pos.details.done")}
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pt-2 pb-8">
              {mode === "takeout" && (
                <>
                  <div role="group" aria-label={t("pos.takeoutKind")} className="grid grid-cols-2 gap-1 rounded-2xl bg-pos-sunken p-1">
                    {(["phone", "walk_in"] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        data-channel={c}
                        aria-pressed={channel === c}
                        onClick={() => setChannel(c)}
                        className={`flex h-[2.545rem] items-center justify-center gap-2 rounded-xl text-base font-bold transition-colors ${
                          channel === c ? "bg-pos-brand text-white shadow-pos-card" : "text-pos-ink hover:bg-pos-card/60"
                        }`}
                      >
                        <Icon name={c === "phone" ? "phone" : "store"} size={20} />
                        {t(`channel.${c}`)}
                      </button>
                    ))}
                  </div>

                  <label>
                    <span className={label}>{t("pos.customerName")}</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" className={field} />
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
                      className={`${field} tabular-nums ${phoneBad ? "shadow-[inset_0_0_0_2px_var(--color-pos-brand)]" : ""}`}
                    />
                    {phoneBad && <span className="mt-1 block text-base font-medium text-pos-brand">{t("pos.phoneInvalid")}</span>}
                  </label>

                  {returningHere && (
                    <div className="flex flex-col gap-3 rounded-pos bg-pos-card p-4 shadow-pos-card">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-base">
                          <Icon name="user" size={18} className="text-pos-gold" />
                          <span>
                            <span className="text-pos-muted">{t("pos.returning")}</span>{" "}
                            <span className="font-semibold">{returningHere.name}</span>
                          </span>
                        </span>
                        {returningHere.name && name.trim() !== returningHere.name && (
                          <button
                            type="button"
                            onClick={() => setName(returningHere.name ?? "")}
                            className="min-h-[2.545rem] rounded-xl px-3 text-base font-semibold text-pos-brand hover:bg-pos-brand-tint"
                          >
                            {t("pos.useName")}
                          </button>
                        )}
                      </div>
                      <div className="text-base font-medium text-pos-muted">{t("pos.recentOrders")}</div>
                      <ul className="flex flex-col gap-2">
                        {returningHere.orders.map((o) => (
                          <li key={o.id} className="flex items-center justify-between gap-2 rounded-xl bg-pos-bg py-2 pr-2 pl-3">
                            <span className="min-w-0 text-base">
                              <span className="block text-pos-muted tabular-nums">
                                {o.businessDate} · {o.orderNumber} · {formatCents(o.totalCents)}
                              </span>
                              <span lang="zh-Hant" className="block truncate font-medium">
                                {o.items.map((l) => `${l.quantity}× ${l.nameZh ?? l.nameEn}`).join("、")}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => reorder(o)}
                              className="flex min-h-[2.545rem] shrink-0 items-center gap-1.5 rounded-xl bg-pos-brand-tint px-3 text-base font-semibold text-pos-brand hover:bg-pos-sunken"
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
                  className={`${field} resize-none py-3`}
                />
              </label>
            </div>
          </div>
        </div>
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
          key={`${sheetItem.item.id}:${sheetItem.sizeId ?? ""}`}
          item={sheetItem.item}
          initialSizeId={sheetItem.sizeId}
          menuNumber={menuNumber(sheetItem.item.id)}
          onAdd={addLine}
          onClose={() => setSheetItem(null)}
        />
      )}
    </main>
  );
}
