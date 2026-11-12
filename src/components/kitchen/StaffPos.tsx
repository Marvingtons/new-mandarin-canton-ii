"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Menu, MenuCategory, MenuItem } from "@/lib/menu/types";
import { indexItems, isAvailable, itemSizes } from "@/lib/menu/types";
import { groupsForSize } from "@/lib/menu/rice";
import { resolveLinePrice } from "@/lib/cart/pricing";
import { itemMatches, queryTerms } from "@/lib/menu/search";
import { formatCents, taxCents } from "@/lib/money";
import { formatPhoneAsTyped, normalizePhone } from "@/lib/phone";
import { staffPickupSlots, clockLabel, type PickupOptions } from "@/lib/order/pickup";
import { isLunchService, LUNCH_END_MINUTES, LUNCH_START_MINUTES } from "@/lib/order/gates";
import { resolveSizeZh } from "@/data/menu-overrides";
import { menuNumber } from "@/data/menu-presentation";
import type { OrderLine, StaffTakeoutChannel } from "@/lib/orders/types";
import type { Station } from "@/config/stations";
import { categoryLook, tintStyle, type CategoryTint } from "@/lib/kitchen/pos-categories";
import { useKT } from "@/components/kitchen/KitchenI18n";
import StaffItemSheet, { type StaffLineDraft } from "@/components/kitchen/StaffItemSheet";
import Icon from "@/components/kitchen/Icon";
import FloorPlan, { type Seating } from "@/components/kitchen/FloorPlan";
import { useKitchenLive } from "@/components/kitchen/KitchenLive";
import ReprintDialog from "@/components/kitchen/ReprintDialog";
import Button from "@/components/kitchen/ui/Button";
import Segmented from "@/components/kitchen/ui/Segmented";
import type { KitchenKey } from "@/lib/kitchen/i18n";
import s from "@/components/kitchen/pos.module.css";
import ui from "@/components/kitchen/ui/ui.module.css";

/**
 * Staff order entry: a phone call, a walk-in, or a table, tapped in and printed.
 * Built to docs/kitchen-design.md (Revision 2) and its mockups; the styles are
 * pos.module.css, whose tokens are the spec's.
 *
 * THIS SCREEN PRICES NOTHING. The totals it shows are resolveLinePrice and
 * taxCents, the same pure functions the server uses, purely so staff can quote
 * the caller a number; the order that prints is the one POST /api/kitchen/orders
 * recomputes from the menu. The request carries no money at all.
 *
 * A TILL, NOT A PAGE. Fixed zones and nothing scrolls but the dishes and the
 * ticket's lines: the shared staff header and a slim POS toolbar (service and
 * search), the category rail, the dish tiles of ONE
 * category, and the ticket with its total and Print pinned at the bottom.
 * Dine-in without a table shows the floor plan in place of the three zones.
 *
 * NAMES, NOT DETAILS. A dish tile is its 中文 and English on its category's
 * tint, nothing else: tap it and the regular size goes on the ticket (its
 * required single choices, like rice, take their defaults); a second size is a
 * chip in the corner. Only a dish with a real decision (an entrée to choose,
 * five party sizes) opens the options sheet. Prices are on the ticket.
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
  /** The printer it went to (store, unless reprinted elsewhere). */
  station: Station;
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

/**
 * The line one tap adds, or null when the dish needs its sheet. Required
 * single-choice groups take their first option, exactly as the sheet would
 * open (useItemChoice); a required multi-choice group is a decision, so it
 * goes to the sheet.
 */
function quickDraft(item: MenuItem, sizeId: string): StaffLineDraft | null {
  const modifierIds: string[] = [];
  for (const g of groupsForSize(item, sizeId)) {
    if (g.minRequired < 1) continue;
    if (g.maxAllowed !== 1 || g.minRequired > 1 || !g.modifiers[0]) return null;
    modifierIds.push(g.modifiers[0].id);
  }
  try {
    resolveLinePrice(item, sizeId, modifierIds, 1);
  } catch {
    return null;
  }
  return { itemId: item.id, sizeId, modifierIds, quantity: 1 };
}

/** "春卷（2條）": the count is data, not name, so it is one step smaller. */
function nameParts(name: string): { base: string; count: string | null } {
  const m = name.match(/^(.*?)(（.+）)$/);
  return m ? { base: m[1], count: m[2] } : { base: name, count: null };
}

function ZhName({ name }: { name: string }) {
  const { base, count } = nameParts(name);
  return (
    <>
      {base}
      {count !== null ? <span className={s.cnt}>{count}</span> : null}
    </>
  );
}

/**
 * When a list outgrows its pane, where the "N more" bar goes: from the end of
 * the last whole item down, so a half item is never shown bare. Null when
 * everything fits or the list is scrolled to its end.
 */
function useMoreBar(listRef: React.RefObject<HTMLElement | null>, itemSelector: string, deps: unknown[]) {
  const [bar, setBar] = useState<{ top: number; hidden: number } | null>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
      if (list.scrollHeight <= list.clientHeight + 1 || atEnd) {
        setBar(null);
        return;
      }
      const box = list.getBoundingClientRect();
      // Room for the bar's own 56px button and its 8px gap, in spec pixels.
      const u = parseFloat(getComputedStyle(document.documentElement).fontSize) / 22;
      const limit = box.bottom - 64 * u;
      const items = [...list.querySelectorAll<HTMLElement>(itemSelector)];
      const whole = items.filter((el) => el.getBoundingClientRect().bottom <= limit);
      const last = whole[whole.length - 1];
      setBar({ top: last ? last.getBoundingClientRect().bottom - box.top + 4 : 0, hidden: items.length - whole.length });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    list.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measure when the caller's content changes
  }, deps);
  return bar;
}

/** A dish tile. Measures its own 中文 so a two-line name drops the English to one. */
function DishTile({
  item,
  tint,
  count,
  disabledLabel,
  altLabel,
  onTap,
  onAlt,
}: {
  item: MenuItem;
  tint: CategoryTint;
  count: number;
  disabledLabel: string | null;
  altLabel: string | null;
  onTap: () => void;
  onAlt: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const tile = ref.current;
    const zh = tile?.querySelector<HTMLElement>(`.${s.zh}`);
    if (!tile || !zh) return;
    const check = () =>
      tile.classList.toggle(s.long, zh.offsetHeight > parseFloat(getComputedStyle(zh).lineHeight) * 1.5);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(tile);
    return () => observer.disconnect();
  }, []);
  const zhName = item.nameZh ?? item.nameEn;
  return (
    <div
      ref={ref}
      style={tintStyle(tint)}
      className={[s.tile, count > 0 && s.hasQ, altLabel && s.hasAlt, disabledLabel && s.off].filter(Boolean).join(" ")}
    >
      <button
        type="button"
        data-item={item.id}
        disabled={disabledLabel !== null}
        onClick={onTap}
        aria-label={item.nameZh ? `${item.nameZh} ${item.nameEn}` : item.nameEn}
        className={s.tileMain}
      />
      <span lang={item.nameZh ? "zh-Hant" : "en"} className={s.zh}>
        <ZhName name={zhName} />
      </span>
      {item.nameZh && (
        <span lang="en" className={s.en}>
          {item.nameEn}
        </span>
      )}
      {count > 0 && (
        <span key={count} className={`${s.qtyBadge} ${s.num}`}>
          {count}
        </span>
      )}
      {disabledLabel && <span className={s.state}>{disabledLabel}</span>}
      {altLabel && !disabledLabel && (
        <button type="button" data-item-size="alt" onClick={onAlt} className={s.alt}>
          {altLabel}
        </button>
      )}
    </div>
  );
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
  /** Each dish's category tint, for its tile and its ticket line. */
  const tintOf = useMemo(() => {
    const map = new Map<string, CategoryTint>();
    for (const c of menu.categories) {
      const { tint } = categoryLook(c);
      for (const i of c.items) map.set(i.id, tint);
    }
    return map;
  }, [menu]);

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
  /** Dine-in with a table, choosing another one. */
  const [floorOpen, setFloorOpen] = useState(false);
  const [pickup, setPickup] = useState("asap");
  const [paymentNote, setPaymentNote] = useState("");
  const [staffNote, setStaffNote] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reprinting, setReprinting] = useState<Placed | null>(null);
  const { act, refresh: refreshLive } = useKitchenLive();
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [justNow, setJustNow] = useState<Placed | null>(null);
  const [clearArmed, setClearArmed] = useState(false);
  /** The line showing its stepper and note, if any. */
  const [editing, setEditing] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);

  // A chosen slot that has since passed falls back to the first one offered.
  const pickupValue = slots.some((x) => x.value === pickup) ? pickup : (slots[0]?.value ?? "");

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
  /** The dish being chosen, the size its tap asked for, and the line it replaces. */
  const [sheetItem, setSheetItem] = useState<{ item: MenuItem; sizeId?: string; replace?: string } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // A native modal: focus stays inside, Escape and the backdrop close it.
  useEffect(() => {
    if (detailsOpen) detailsRef.current?.showModal();
  }, [detailsOpen]);
  // Search opens on a tap of its button, so the field takes the keyboard.
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);
  const [activeCategory, setActiveCategory] = useState<string>(menu.categories[0]?.id ?? "");
  const category = menu.categories.find((c) => c.id === activeCategory) ?? menu.categories[0];

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
      .filter(({ item, category: c }) =>
        itemMatches(item, terms, `${c.nameEn} ${c.nameZh ?? ""} ${menuNumber(item.id) ?? ""}`),
      )
      .map(({ item }) => item);
  }, [query, menu]);

  const orderable = useCallback(
    (item: MenuItem) => isAvailable(item) && (!item.lunchSpecial || lunchOpen),
    [lunchOpen],
  );

  const dishPaneRef = useRef<HTMLElement>(null);
  function jumpTo(c: MenuCategory) {
    setQuery("");
    setSearchOpen(false);
    setActiveCategory(c.id);
    dishPaneRef.current?.scrollTo({ top: 0 });
  }

  /** A tile's tap: straight onto the ticket, or the sheet when there is a choice to make. */
  function tapDish(item: MenuItem, sizeId?: string) {
    const sizes = itemSizes(item);
    const size = sizeId ?? (sizes.length <= 2 ? sizes[0]?.id : undefined);
    const draft = size ? quickDraft(item, size) : null;
    if (draft) addLine(draft);
    else setSheetItem({ item, sizeId });
  }

  const linesRef = useRef<HTMLDivElement>(null);
  function addLine(draft: StaffLineDraft, replace?: string) {
    setLines((prev) => {
      const rest = replace ? prev.filter((l) => l.lineId !== replace) : prev;
      // Same dish, same choices, no note: bump the quantity rather than add a
      // second identical row the kitchen has to sum.
      const same = rest.find(
        (l) =>
          !l.specialInstructions &&
          !draft.specialInstructions &&
          l.itemId === draft.itemId &&
          l.sizeId === draft.sizeId &&
          [...l.modifierIds].sort().join() === [...draft.modifierIds].sort().join(),
      );
      if (same) {
        return rest.map((l) =>
          l.lineId === same.lineId ? { ...l, quantity: Math.min(50, l.quantity + draft.quantity) } : l,
        );
      }
      return [...rest, { ...draft, lineId: newKey() }];
    });
    setSheetItem(null);
    setPlaced(null);
    setError(null);
    // The newest line is the one to see.
    requestAnimationFrame(() => linesRef.current?.scrollTo({ top: linesRef.current.scrollHeight }));
  }

  function setQty(lineId: string, quantity: number) {
    if (quantity < 1) setEditing(null);
    setLines((prev) =>
      quantity < 1 ? prev.filter((l) => l.lineId !== lineId) : prev.map((l) => (l.lineId === lineId ? { ...l, quantity: Math.min(50, quantity) } : l)),
    );
  }

  function setNote(lineId: string, note: string) {
    setLines((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, specialInstructions: note || undefined } : l)));
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
      let ok = !!item && orderable(item) && itemSizes(item).some((x) => x.id === line.sizeId);
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
    setEditing(null);
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
      // The board, the header's count and the printer strip learn about it
      // now rather than on the next poll.
      void refreshLive();
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

  /** 重印 the order just placed: the shared station picker, the shared live action. */
  function reprint(order: Placed) {
    setReprinting(order);
  }

  /* ------------------------------------------------------------- render -- */
  /** How many of each dish are on the ticket, for the badge on its tile. */
  const onTicket = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of lines) counts.set(l.itemId, (counts.get(l.itemId) ?? 0) + l.quantity);
    return counts;
  }, [lines]);

  const showFloor = mode === "dine_in" && (!seating || floorOpen);
  const railRef = useRef<HTMLElement>(null);
  const railBar = useMoreBar(railRef, "button", [menu, showFloor]);
  const linesBar = useMoreBar(linesRef, `.${s.line}`, [lines, editing, noteOpen, showFloor]);

  const tile = (item: MenuItem) => {
    const sizes = itemSizes(item);
    const disabledLabel = !isAvailable(item)
      ? t("pos.86d")
      : item.lunchSpecial === true && !lunchOpen
        ? t("pos.lunchClosed")
        : null;
    const alt = sizes.length === 2 ? sizes[1] : null;
    return (
      <DishTile
        key={item.id}
        item={item}
        tint={tintOf.get(item.id) ?? "sides"}
        count={onTicket.get(item.id) ?? 0}
        disabledLabel={disabledLabel}
        altLabel={alt ? (resolveSizeZh(alt.label) ?? alt.label) : null}
        onTap={() => tapDish(item)}
        onAlt={() => alt && tapDish(item, alt.id)}
      />
    );
  };

  const field =
    "min-h-[3rem] w-full rounded-xl bg-staff-panel px-4 text-[1.091rem] text-staff-ink shadow-[inset_0_0_0_2px_var(--color-staff-sunken)] outline-none placeholder:text-staff-soft focus:shadow-[inset_0_0_0_2px_var(--color-staff-brand)]";
  const label = "mb-2 block text-base font-semibold text-staff-ink";
  const customerSummary = [name.trim(), phone.trim()].filter(Boolean).join(" · ");
  const btn = (kind: "primary" | "secondary" | "quiet") => `${ui.btn} ${ui[kind]}`;

  const searchField = searchOpen ? (
    <div className={s.searchField}>
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
        ref={searchRef}
      />
      <button
        type="button"
        onClick={() => {
          setQuery("");
          setSearchOpen(false);
        }}
        aria-label={t("pos.searchClose")}
        className={`${btn("quiet")} ${ui.icon}`}
      >
        <Icon name="x" size={24} />
      </button>
    </div>
  ) : null;

  const look = category ? categoryLook(category) : null;

  /* ---- ticket header: the order type and who or which table, strongest on screen ---- */
  const placedStatus = placed && (
    <div role="status" className={s.status}>
      <Icon name="check" size={24} />
      <span className={`${s.big} ${s.num}`}>{placed.orderNumber}</span>
      <span>{t("pos.sent")}</span>
    </div>
  );

  const ticketHead = (
    <div className={s.tHead}>
      {placedStatus}
      {justNow && !placed && (
        <div className={s.status}>
          <span>
            {t("pos.justNow")} <span className={s.num}>{justNow.orderNumber}</span>
          </span>
          <button type="button" onClick={() => reprint(justNow)} className={btn("quiet")}>
            <Icon name="printer" size={22} />
            {t("pos.reprint")}
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className={s.status}>
          {notice}
        </p>
      )}
      <div className={s.tRow}>
        <div className={s.tCtx}>
          <span lang="zh-Hant" className={s.key}>
            {t(mode === "takeout" ? "pos.mode.takeoutZh" : "pos.mode.dineInZh")}
          </span>
          <span className={s.ctx}>
            {mode === "dine_in" && seating
              ? t("pos.table.summaryZh", { table: seating.label, guests: seating.guests })
              : name.trim() || t(`channel.${channel}`)}
          </span>
          {mode === "dine_in" && seating?.addon && <span className={s.addonTag}>{t("ticket.addon")}</span>}
        </div>
        {(lines.length > 0 || customerSummary) && (
          <button
            type="button"
            aria-label={clearArmed ? t("pos.clearConfirm") : t("pos.clearOrder")}
            onClick={() => {
              if (lines.length === 0 || clearArmed) {
                resetTicket();
                setPlaced(null);
                setError(null);
              } else {
                setClearArmed(true);
              }
            }}
            className={clearArmed ? btn("quiet") : `${btn("quiet")} ${ui.icon}`}
          >
            {clearArmed ? t("pos.clearConfirm") : <Icon name="trash" size={24} />}
          </button>
        )}
      </div>
      {mode === "dine_in" ? (
        <div className={s.row2}>
          <button type="button" data-seating={seating?.label ?? ""} onClick={() => setFloorOpen(true)} className={btn("secondary")}>
            {t("pos.changeTable")}
          </button>
          <button type="button" onClick={() => setDetailsOpen(true)} className={btn("secondary")}>
            {t("pos.notesButton")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          data-context="takeout"
          onClick={() => setDetailsOpen(true)}
          aria-label={t("pos.details.open", { summary: customerSummary || t(`channel.${channel}`) })}
          className={btn("secondary")}
        >
          {phone.trim() ? <span className={s.num}>{phone.trim()}</span> : t("pos.addCustomer")}
        </button>
      )}
    </div>
  );

  const ticketLines =
    lines.length === 0 ? (
      <div className={s.empty}>
        <span lang="zh-Hant" className={s.zh}>
          {t("pos.ticketEmptyZh")}
        </span>
        <span lang="en" className={s.en}>
          {t("pos.ticketEmptyEn")}
        </span>
      </div>
    ) : (
      priced.map(({ line, item, lineCents }) => {
        const size = item ? itemSizes(item).find((x) => x.id === line.sizeId) : undefined;
        const tag = size && !isDefaultSize(size.label) ? (resolveSizeZh(size.label) ?? size.label) : null;
        // Choices worth reading: what a default would not have picked.
        const defaults = new Set(item ? (quickDraft(item, line.sizeId)?.modifierIds ?? []) : []);
        const mods = item
          ? item.modifierGroups
              .flatMap((g) => g.modifiers)
              .filter((m) => line.modifierIds.includes(m.id) && !defaults.has(m.id))
              .map((m) => m.nameZh ?? m.nameEn)
          : [];
        const isEditing = editing === line.lineId;
        const zhName = item?.nameZh ?? item?.nameEn ?? line.itemId;
        return (
          <div
            key={line.lineId}
            className={`${s.line} ${isEditing ? s.editing : ""}`}
            style={tintStyle(tintOf.get(line.itemId) ?? "sides")}
          >
            <button
              type="button"
              aria-expanded={isEditing}
              onClick={() => {
                setEditing(isEditing ? null : line.lineId);
                setNoteOpen(false);
              }}
              className={s.lineHit}
            >
              <span className={s.st} />
              <span className={`${s.q} ${s.num}`}>{line.quantity}</span>
              <span style={{ minWidth: 0 }}>
                <span lang={item?.nameZh ? "zh-Hant" : "en"} className={`${s.zh} ${s.one}`}>
                  <ZhName name={zhName} />
                  {tag && <span className={s.tag}>{tag}</span>}
                </span>
                {item?.nameZh && (
                  <span lang="en" className={`${s.en} ${s.one}`}>
                    {[item.nameEn, ...mods].join(" · ")}
                  </span>
                )}
                {line.specialInstructions && <span className={s.note}>{line.specialInstructions}</span>}
              </span>
              <span className={`${s.lp} ${s.num}`}>{formatCents(lineCents)}</span>
            </button>
            {isEditing && (
              <div className={s.edit}>
                <div className={s.stepper}>
                  <button type="button" aria-label={t("pos.decrease")} onClick={() => setQty(line.lineId, line.quantity - 1)} className={btn("quiet")}>
                    <Icon name={line.quantity > 1 ? "minus" : "trash"} size={24} />
                  </button>
                  <span className={`${s.q} ${s.num}`}>{line.quantity}</span>
                  <button type="button" aria-label={t("pos.increase")} onClick={() => setQty(line.lineId, line.quantity + 1)} className={btn("quiet")}>
                    <Icon name="plus" size={24} />
                  </button>
                </div>
                <button type="button" aria-pressed={noteOpen} onClick={() => setNoteOpen((o) => !o)} className={btn("secondary")}>
                  {t("pos.lineNoteButton")}
                </button>
                {item && item.modifierGroups.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSheetItem({ item, sizeId: line.sizeId, replace: line.lineId })}
                    className={btn("secondary")}
                  >
                    {t("pos.options")}
                  </button>
                )}
                {noteOpen && (
                  <input
                    value={line.specialInstructions ?? ""}
                    onChange={(e) => setNote(line.lineId, e.target.value)}
                    maxLength={200}
                    placeholder={t("pos.lineNotePlaceholder")}
                    aria-label={t("pos.lineNoteButton")}
                    autoComplete="off"
                    className={s.noteField}
                  />
                )}
              </div>
            )}
          </div>
        );
      })
    );

  const printLabel = submitting ? (
    t("pos.printing")
  ) : lines.length === 0 ? (
    <>
      <span lang="zh-Hant" className={s.zh}>
        {t("pos.printEmptyZh")}
      </span>{" "}
      {t("pos.printEmptyEn")}
    </>
  ) : (
    <>
      <span>
        <span lang="zh-Hant" className={s.zh}>
          {t("pos.printZh")}
        </span>{" "}
        {t("pos.printEn")}
      </span>
      <span className={s.num}>{formatCents(total)}</span>
    </>
  );

  return (
    <main className={`${s.root} ${showFloor ? s.floorMode : ""}`}>
      {/* The POS's own controls, under the shared staff header: service mode
          and search, plus lunch hours when the clock has not opened lunch. */}
      <div className={s.top}>
        {searchField ?? (
          <Segmented
            label={t("pos.mode")}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
              setFloorOpen(false);
            }}
            options={(["takeout", "dine_in"] as const).map((m) => ({
              value: m,
              ariaLabel: t(m === "takeout" ? "pos.mode.takeout" : "pos.mode.dineIn"),
              label: (
                <>
                  <span lang="zh-Hant" className={s.zh}>
                    {t(m === "takeout" ? "pos.mode.takeoutZh" : "pos.mode.dineInZh")}
                  </span>
                  <span lang="en">{t(m === "takeout" ? "pos.mode.takeoutEn" : "pos.mode.dineInEn")}</span>
                </>
              ),
            }))}
          />
        )}
        <div className={s.topRight}>
          {!lunchNow && (
            <Button
              variant={lunchOverride ? "primary" : "secondary"}
              icon="clock"
              aria-pressed={lunchOverride}
              title={t("pos.lunchOverrideHint")}
              onClick={() => setLunchOverride((v) => !v)}
            >
              {t("pos.lunchHours")}
            </Button>
          )}
          {!searchField && (
            <Button
              variant="secondary"
              iconOnly
              icon="search"
              aria-label={t("pos.search")}
              onClick={() => {
                if (showFloor) setMode("takeout");
                setSearchOpen(true);
              }}
            />
          )}
        </div>
      </div>

      {showFloor ? (
        <FloorPlan
          placed={placedStatus}
          onBack={seating ? () => setFloorOpen(false) : null}
          onSeat={(next) => {
            setSeating(next);
            setMode("dine_in");
            setFloorOpen(false);
            setError(null);
            setPlaced(null);
          }}
          onCleared={(cleared) => {
            if (seating?.label === cleared) setSeating(null);
          }}
        />
      ) : (
        <>
          {/* ---------------------------------------------- categories -- */}
          <div className={s.railWrap}>
            <nav ref={railRef} aria-label={t("pos.categories")} className={`${s.rail} ${s.scroll}`}>
              {menu.categories.map((c) => {
                const l = categoryLook(c);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => jumpTo(c)}
                    aria-current={c.id === category?.id && !results ? "true" : undefined}
                    style={tintStyle(l.tint)}
                  >
                    <span className={s.sw} />
                    <span lang={l.zh ? "zh-Hant" : "en"} className={s.zh}>
                      {l.zh ?? l.en}
                    </span>
                    {l.zh && (
                      <span lang="en" className={`${s.en} ${s.one}`}>
                        {l.en}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
            {railBar && (
              <div className={s.more} style={{ top: railBar.top }}>
                <button
                  type="button"
                  onClick={() => railRef.current?.scrollBy({ top: railRef.current.clientHeight * 0.75, behavior: "smooth" })}
                  className={btn("secondary")}
                >
                  {t("pos.moreCategories", { n: railBar.hidden })}
                </button>
              </div>
            )}
          </div>

          {/* -------------------------------------------------- dishes -- */}
          <section ref={dishPaneRef} aria-label={t("pos.title")} className={`${s.dishes} ${s.scroll}`}>
            {lunchOverride && !lunchNow && (
              <p role="status" className={s.banner}>
                <Icon name="alert" size={22} />
                {t("pos.lunchOverrideWarning", lunchLabel)}
              </p>
            )}
            {results ? (
              <>
                <h2 className={s.sectionH}>
                  <span className={s.zh}>{t("pos.results")}</span>
                </h2>
                {results.length === 0 ? (
                  <p className={s.emptyNote}>{t("pos.noResults", { q: query.trim() })}</p>
                ) : (
                  <div className={s.grid}>{results.map(tile)}</div>
                )}
              </>
            ) : (
              category &&
              look && (
                <section id={`pos-cat-${category.id}`}>
                  <h2 className={s.sectionH}>
                    <span lang={look.zh ? "zh-Hant" : "en"} className={s.zh}>
                      {look.zh ?? look.en}
                    </span>
                    {look.zh && (
                      <span lang="en" className={s.en}>
                        {category.nameEn}
                      </span>
                    )}
                    {category.items.some((i) => i.lunchSpecial) && (
                      <span className={s.en}>· {t("pos.lunchWindow", lunchLabel)}</span>
                    )}
                  </h2>
                  <div className={s.grid}>{category.items.map(tile)}</div>
                </section>
              )
            )}
          </section>

          {/* -------------------------------------------------- ticket -- */}
          <aside aria-label={t("pos.ticket")} className={s.ticket}>
            {ticketHead}
            <div className={s.linesWrap}>
              <div ref={linesRef} className={`${s.lines} ${s.scroll}`}>
                {ticketLines}
              </div>
              {linesBar && (
                <div className={s.more} style={{ top: linesBar.top }}>
                  <button
                    type="button"
                    onClick={() => linesRef.current?.scrollBy({ top: linesRef.current.clientHeight * 0.75, behavior: "smooth" })}
                    className={btn("secondary")}
                  >
                    {t("pos.moreLines", { n: linesBar.hidden })}
                  </button>
                </div>
              )}
            </div>

            <div className={s.tFoot}>
              {lines.length > 0 && (
                <div className={`${s.sums} ${s.num}`}>
                  <span>
                    {t("pos.subtotal")} {formatCents(subtotal)}
                  </span>
                  <span>
                    {t("pos.tax")} {formatCents(tax)}
                  </span>
                </div>
              )}
              <div className={s.total}>
                <span className={s.l}>
                  <span lang="zh-Hant">{t("pos.totalZh")}</span>{" "}
                  <span lang="en" className={s.en}>
                    {t("pos.totalEn")}
                  </span>
                </span>
                <span className={`${s.v} ${s.num}`}>{formatCents(total)}</span>
              </div>
              {error && (
                <p role="alert" className={s.alert}>
                  {error}
                </p>
              )}
              {!error && lines.length > 0 && missing.length > 0 && (
                <p className={s.alert}>{missing.map((k) => t(k)).join(" · ")}</p>
              )}
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                data-action="print"
                className={`${ui.btn} ${canSubmit ? ui.primary : ""} ${s.print}`}
              >
                {printLabel}
              </button>
            </div>
          </aside>
        </>
      )}

      {/* --------------------------------------- customer details + notes -- */}
      {detailsOpen && (
        <dialog
          ref={detailsRef}
          aria-label={mode === "takeout" ? t("pos.details.title") : t("pos.notesTitle")}
          onClose={() => setDetailsOpen(false)}
          className="m-0 h-full max-h-none w-full max-w-none justify-end overflow-hidden bg-transparent p-0 text-staff-ink open:flex backdrop:bg-transparent"
        >
          {/* The scrim is a button inside the dialog, so the dialog itself
              carries no click handler; Escape closes it natively. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="absolute inset-0 bg-staff-scrim"
            onClick={() => detailsRef.current?.close()}
          />
          <div className="staff-sheet-in relative flex h-full w-full max-w-[26rem] flex-col bg-staff-bg shadow-staff-raised">
            <div className="flex h-[var(--z-top)] shrink-0 items-center justify-between gap-4 px-6">
              <h2 className="text-[1.273rem] font-bold">{mode === "takeout" ? t("pos.details.title") : t("pos.notesTitle")}</h2>
              <button
                type="button"
                data-action="details-done"
                onClick={() => detailsRef.current?.close()}
                className="flex h-[2.545rem] items-center rounded-xl bg-staff-brand px-5 text-base font-bold text-staff-on-brand hover:bg-staff-brand-hover"
              >
                {t("pos.details.done")}
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pt-2 pb-8">
              {mode === "takeout" && (
                <>
                  <div role="group" aria-label={t("pos.takeoutKind")} className="grid grid-cols-2 gap-1 rounded-2xl bg-staff-sunken p-1">
                    {(["phone", "walk_in"] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        data-channel={c}
                        aria-pressed={channel === c}
                        onClick={() => setChannel(c)}
                        className={`flex h-[2.545rem] items-center justify-center gap-2 rounded-xl text-base font-bold transition-colors ${
                          channel === c ? "bg-staff-brand text-staff-on-brand shadow-staff-card" : "text-staff-ink hover:bg-staff-panel/60"
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
                      className={`${field} tabular-nums ${phoneBad ? "shadow-[inset_0_0_0_2px_var(--color-staff-brand)]" : ""}`}
                    />
                    {phoneBad && <span className="mt-1 block text-base font-medium text-staff-brand">{t("pos.phoneInvalid")}</span>}
                  </label>

                  {returningHere && (
                    <div className="flex flex-col gap-3 rounded-pos bg-staff-panel p-4 shadow-staff-card">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-base">
                          <Icon name="user" size={18} className="text-staff-ink" />
                          <span>
                            <span className="text-staff-soft">{t("pos.returning")}</span>{" "}
                            <span className="font-semibold">{returningHere.name}</span>
                          </span>
                        </span>
                        {returningHere.name && name.trim() !== returningHere.name && (
                          <button
                            type="button"
                            onClick={() => setName(returningHere.name ?? "")}
                            className="min-h-[2.545rem] rounded-xl px-3 text-base font-semibold text-staff-brand hover:bg-staff-brand-tint"
                          >
                            {t("pos.useName")}
                          </button>
                        )}
                      </div>
                      <div className="text-base font-medium text-staff-soft">{t("pos.recentOrders")}</div>
                      <ul className="flex flex-col gap-2">
                        {returningHere.orders.map((o) => (
                          <li key={o.id} className="flex items-center justify-between gap-2 rounded-xl bg-staff-bg py-2 pr-2 pl-3">
                            <span className="min-w-0 text-base">
                              <span className="block text-staff-soft tabular-nums">
                                {o.businessDate} · {o.orderNumber} · {formatCents(o.totalCents)}
                              </span>
                              <span lang="zh-Hant" className="block truncate font-medium">
                                {o.items.map((l) => `${l.quantity}× ${l.nameZh ?? l.nameEn}`).join("、")}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => reorder(o)}
                              className="flex min-h-[2.545rem] shrink-0 items-center gap-1.5 rounded-xl bg-staff-brand-tint px-3 text-base font-semibold text-staff-brand hover:bg-staff-sunken"
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
                      {slots.map((x) => (
                        <option key={x.value} value={x.value}>
                          {x.value === "asap" ? t("pos.asap", { n: pickupOptions.leadMinutes }) : x.label}
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
        </dialog>
      )}

      {sheetItem && (
        <StaffItemSheet
          key={`${sheetItem.item.id}:${sheetItem.sizeId ?? ""}:${sheetItem.replace ?? ""}`}
          item={sheetItem.item}
          initialSizeId={sheetItem.sizeId}
          menuNumber={menuNumber(sheetItem.item.id)}
          onAdd={(draft) => addLine(draft, sheetItem.replace)}
          onClose={() => setSheetItem(null)}
        />
      )}
      {reprinting && (
        <ReprintDialog
          order={reprinting}
          onClose={() => setReprinting(null)}
          onReprint={(station) => {
            const order = reprinting;
            setReprinting(null);
            void act(order, "reprint", { station }).then((ok) => {
              if (ok) setJustNow({ ...order, station });
            });
          }}
        />
      )}
    </main>
  );
}
