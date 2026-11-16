"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Menu, MenuCategory, MenuItem } from "@/lib/menu/types";
import { indexItems, isAvailable, itemSizes } from "@/lib/menu/types";
import { resolveLinePrice } from "@/lib/cart/pricing";
import { itemMatches, queryTerms } from "@/lib/menu/search";
import { formatCents, taxCents } from "@/lib/money";
import { formatPhoneAsTyped, normalizePhone } from "@/lib/phone";
import { staffPickupSlots, clockLabel, type PickupOptions } from "@/lib/order/pickup";
import { isLunchService, LUNCH_END_MINUTES, LUNCH_START_MINUTES } from "@/lib/order/gates";
import { resolveSizeZh } from "@/data/menu-overrides";
import { RICE_GROUP_ID } from "@/lib/menu/rice";
import { menuNumber } from "@/data/menu-presentation";
import type { OrderLine, StaffChannel } from "@/lib/orders/types";
import type { Station } from "@/config/stations";
import { categoryLook, tintStyle, type CategoryTint } from "@/lib/kitchen/posCategories";
import { useKT } from "@/components/kitchen/KitchenI18n";
import PosItemSheet, { type PosLineDraft } from "@/components/kitchen/PosItemSheet";
import Icon from "@/components/kitchen/Icon";
import { useKitchenLive } from "@/components/kitchen/KitchenLive";
import ReprintDialog from "@/components/kitchen/ReprintDialog";
import { ConfirmDialog } from "@/components/kitchen/ui/Dialog";
import Button from "@/components/kitchen/ui/Button";
import type { KitchenKey } from "@/lib/kitchen/i18n";
import s from "@/components/kitchen/pos.module.css";
import ui from "@/components/kitchen/ui/ui.module.css";
import { useToast } from "@/components/kitchen/ui/Toasts";
import { useShortcuts } from "@/components/kitchen/ui/shortcuts";
import {
  INITIAL_DEFAULTS,
  isRiceDefault,
  isSizeDefault,
  POS_RICE_STORAGE_KEY,
  POS_SIZE_STORAGE_KEY,
  quickAdd,
  RICE_DEFAULTS,
  SIZE_DEFAULTS,
  withRice,
  type PosDefaults,
  type RiceDefault,
  type SizeDefault,
} from "@/lib/kitchen/posDefaults";

/**
 * Staff order entry: a phone call or a walk-in, tapped in and printed.
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
 *
 * NAMES, NOT DETAILS. A dish tile is its 中文 and English on its category's
 * tint, nothing else: tap it and the regular size goes on the ticket; a second
 * size is a chip in the corner. A dish with ANY required choice (a lunch
 * entrée, an "or" dish, the rice) or five party sizes opens the options sheet
 * instead, with the choice unmade: one tap never decides for the caller.
 * Prices are on the ticket.
 *
 * Every dish shows 中文 large and English beneath regardless of the language
 * toggle, because the person taking the call and the person at the wok may
 * read different ones.
 */

interface TicketLine extends PosLineDraft {
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

/** The lunch window as staff read it, e.g. "11:00 AM" to "3:00 PM". */
const lunchLabel = {
  from: clockLabel(LUNCH_START_MINUTES),
  to: clockLabel(LUNCH_END_MINUTES),
};

/** The details sheet's text fields and their labels: the shared control height, radius and type. */
const field =
  "min-h-14 w-full rounded-staff-control bg-staff-panel px-4 text-staff-title text-staff-ink shadow-[inset_0_0_0_2px_var(--color-staff-sunken)] outline-none placeholder:text-staff-soft focus-visible:shadow-[inset_0_0_0_2px_var(--color-staff-brand)]";
const label = "mb-2 block text-staff-body font-semibold text-staff-ink";

/** The shared staff button classes (components/kitchen/ui). */
const btn = (kind: "primary" | "secondary" | "quiet") => `${ui.btn} ${ui[kind]}`;

/** The strip's labels: 中文 over English on the button, all three languages for assistive tech. */
const RICE_LABEL: Record<RiceDefault, { zh: KitchenKey; en: KitchenKey; all: KitchenKey }> = {
  steamed: { zh: "pos.riceSteamedZh", en: "pos.riceSteamedEn", all: "pos.riceSteamedAll" },
  fried: { zh: "pos.riceFriedZh", en: "pos.riceFriedEn", all: "pos.riceFriedAll" },
  half: { zh: "pos.riceHalfZh", en: "pos.riceHalfEn", all: "pos.riceHalfAll" },
  none: { zh: "pos.riceNoneZh", en: "pos.riceNoneEn", all: "pos.riceNoneAll" },
};
const SIZE_LABEL: Record<SizeDefault, { zh: KitchenKey; en: KitchenKey; all: KitchenKey }> = {
  individual: { zh: "pos.sizeIndividualZh", en: "pos.sizeIndividualEn", all: "pos.sizeIndividualAll" },
  tray: { zh: "pos.sizeTrayZh", en: "pos.sizeTrayEn", all: "pos.sizeTrayAll" },
};

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
 * How many ticket lines sit wholly or partly below the visible list, for the
 * row under it. Zero when everything fits or the list is at its end.
 */
function useLinesBelow(listRef: React.RefObject<HTMLElement | null>, itemSelector: string, deps: unknown[]) {
  const [below, setBelow] = useState(0);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const bottom = list.getBoundingClientRect().bottom;
      const items = [...list.querySelectorAll<HTMLElement>(itemSelector)];
      setBelow(items.filter((el) => el.getBoundingClientRect().bottom > bottom + 1).length);
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
  return below;
}

/**
 * A dish tile. The body adds one with the strip's defaults; the 改 corner
 * opens the full sheet. A dot marks a dish whose tap will ask (a required
 * choice the defaults do not cover). Measures its own 中文 so a two-line name
 * drops the English to one.
 */
function DishTile({
  item,
  tint,
  count,
  disabledLabel,
  asks,
  flash,
  hint,
  labels,
  onTap,
  onModify,
}: {
  item: MenuItem;
  tint: CategoryTint;
  count: number;
  disabledLabel: string | null;
  /** The tap opens the sheet instead of adding. */
  asks: boolean;
  /** Bumped on each tap that added: replays the highlight. */
  flash: number;
  /** The number key that adds it (search results), if any. */
  hint: number | null;
  labels: { modify: string; modifyShort: string; asks: string };
  onTap: () => void;
  onModify: () => void;
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
  const name = item.nameZh ? `${item.nameZh} ${item.nameEn}` : item.nameEn;
  return (
    <div
      ref={ref}
      style={tintStyle(tint)}
      data-tile={item.id}
      className={[s.tile, count > 0 && s.hasQ, !disabledLabel && s.hasMod, disabledLabel && s.off].filter(Boolean).join(" ")}
    >
      <button
        type="button"
        data-item={item.id}
        data-asks={asks || undefined}
        disabled={disabledLabel !== null}
        onClick={onTap}
        aria-label={asks ? `${name} · ${labels.asks}` : name}
        className={s.tileMain}
      />
      {flash > 0 && <span key={`flash-${flash}`} aria-hidden="true" className={s.tapFlash} />}
      <span lang={item.nameZh ? "zh-Hant" : "en"} className={s.zh}>
        {hint !== null && <span className={`${s.hint} ${s.num}`}>{hint}</span>}
        <ZhName name={zhName} />
      </span>
      {item.nameZh && (
        <span lang="en" className={s.en}>
          {item.nameEn}
        </span>
      )}
      {asks && !disabledLabel && <span aria-hidden="true" title={labels.asks} className={s.asks} />}
      {count > 0 && (
        <span key={`qty-${count}`} className={`${s.qtyBadge} ${s.num}`}>
          {count}
        </span>
      )}
      {disabledLabel && <span className={s.state}>{disabledLabel}</span>}
      {!disabledLabel && (
        <button
          type="button"
          data-modify={item.id}
          onClick={onModify}
          aria-label={`${labels.modify} ${name}`}
          title={labels.modify}
          className={s.mod}
        >
          <span lang="zh-Hant">{labels.modifyShort}</span>
        </button>
      )}
    </div>
  );
}

export default function PosScreen({
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

  const slots = useMemo(
    () => (now ? staffPickupSlots(now, pickupOptions, { asIfOpen }) : []),
    [now, pickupOptions, asIfOpen],
  );

  /* ---------------------------------------------------------- the ticket -- */
  const [lines, setLines] = useState<TicketLine[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<StaffChannel>("phone");
  /** "Scheduled for": a staff-chosen "HH:MM", or "" for none (ASAP, no time printed). */
  const [scheduled, setScheduled] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [staffNote, setStaffNote] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reprinting, setReprinting] = useState<Placed | null>(null);
  const { act, refresh: refreshLive } = useKitchenLive();
  const { toast } = useToast();

  /* ---------------------------------------------- the sticky defaults -- */
  // The rice and size every tile tap uses, kept per tablet. Read after mount
  // so the server render and hydration agree.
  const [defaults, setDefaults] = useState<PosDefaults>(INITIAL_DEFAULTS);
  useEffect(() => {
    const rice = localStorage.getItem(POS_RICE_STORAGE_KEY);
    const size = localStorage.getItem(POS_SIZE_STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a stored per-device preference, read once
    setDefaults({
      rice: isRiceDefault(rice) ? rice : INITIAL_DEFAULTS.rice,
      size: isSizeDefault(size) ? size : INITIAL_DEFAULTS.size,
    });
  }, []);
  function setRiceDefault(rice: RiceDefault) {
    setDefaults((d) => ({ ...d, rice }));
    localStorage.setItem(POS_RICE_STORAGE_KEY, rice);
  }
  function setSizeDefault(size: SizeDefault) {
    setDefaults((d) => ({ ...d, size }));
    localStorage.setItem(POS_SIZE_STORAGE_KEY, size);
  }
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [justNow, setJustNow] = useState<Placed | null>(null);
  /** The clear-ticket confirm is open (a destructive action, like cancel). */
  const [confirmClear, setConfirmClear] = useState(false);

  // "Scheduled for" offers the clock times; leaving it empty is ASAP, which
  // the store only takes while its doors are open.
  const scheduledSlots = slots.filter((x) => x.value !== "asap");
  const asapOpen = slots.some((x) => x.value === "asap");
  // A chosen time that has since passed is NOT swapped for another one: what
  // prints is what staff told the caller, so they choose again.
  const scheduledOk = scheduled === "" ? asapOpen : scheduledSlots.some((x) => x.value === scheduled);
  const scheduledLabel = scheduledSlots.find((x) => x.value === scheduled)?.label ?? null;

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
  if (channel === "phone" && !phoneE164) missing.push("pos.missing.phone");
  if (now && !scheduledOk) missing.push("pos.missing.scheduled");
  const canSubmit = missing.length === 0 && !submitting && taxRateBps != null && !phoneBad && now !== null;

  /* ------------------------------------------------------ menu selection -- */
  const [query, setQuery] = useState("");
  /**
   * The dish being chosen: the size to open on, the one choice to open
   * expanded (a group id, or "size"), and the line it replaces.
   */
  const [sheetItem, setSheetItem] = useState<{
    item: MenuItem;
    sizeId?: string;
    focus?: string;
    replace?: string;
    initial?: { modifierIds?: readonly string[]; quantity?: number; instructions?: string };
  } | null>(null);
  /** The tile just tapped, and a counter that replays its highlight. */
  const [tileFlash, setTileFlash] = useState<{ id: string; n: number }>({ id: "", n: 0 });
  /** The ticket line just added or bumped, likewise. */
  const [lineFlash, setLineFlash] = useState<{ id: string; n: number }>({ id: "", n: 0 });
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
  /**
   * The rail's order: 招牌菜 Specials, 午餐 Lunch Specials (only while lunch
   * is open, by the clock or the override), 家庭餐 Family Dinners, then the
   * rest in menu order. The grid shows them all, in the same order.
   */
  const railCategories = useMemo(() => {
    const first = ["specials", ...(lunchOpen ? ["lunch-specials"] : []), "family-dinners"];
    const pinned = first.map((id) => menu.categories.find((c) => c.id === id)).filter((c) => c !== undefined);
    const rest = menu.categories.filter((c) => !first.includes(c.id) && c.id !== "lunch-specials");
    return [...pinned, ...rest];
  }, [menu, lunchOpen]);
  const [activeCategory, setActiveCategory] = useState<string>(railCategories[0]?.id ?? "");

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
    const found: MenuItem[] = [];
    for (const { item, category: c } of all) {
      if (itemMatches(item, terms, `${c.nameEn} ${c.nameZh ?? ""} ${menuNumber(item.id) ?? ""}`)) found.push(item);
    }
    return found;
  }, [query, menu]);

  const orderable = useCallback(
    (item: MenuItem) => isAvailable(item) && (!item.lunchSpecial || lunchOpen),
    [lunchOpen],
  );

  const dishPaneRef = useRef<HTMLElement>(null);
  /** Set while the grid scrolls to a rail tap, so the spy does not fight it. */
  const jumping = useRef(false);
  function jumpTo(c: MenuCategory) {
    setQuery("");
    setSearchOpen(false);
    setActiveCategory(c.id);
    jumping.current = true;
    // After the render that brings the categories back (if search was open).
    requestAnimationFrame(() => {
      const pane = dishPaneRef.current;
      const section = pane?.querySelector<HTMLElement>(`[data-cat="${c.id}"]`);
      if (pane && section) pane.scrollTo({ top: section.offsetTop - pane.offsetTop });
      requestAnimationFrame(() => {
        jumping.current = false;
      });
    });
  }

  function closeSearch() {
    setQuery("");
    setSearchOpen(false);
  }

  /**
   * Keyboard, for a laptop at the counter. Never while typing in a field or
   * with a sheet open (useShortcuts):
   *   /     open the search and put the cursor in it
   *   Esc   clear the search
   *   1-9   with search results up, add that result with the strip's
   *         defaults (or open its sheet if it asks)
   */
  const resultKeys: Record<string, () => void> = {};
  for (let n = 1; n <= 9; n++) {
    resultKeys[String(n)] = () => {
      const item = results?.[n - 1];
      if (item && orderable(item)) tapDish(item);
    };
  }
  useShortcuts({
    "/": () => {
      if (searchOpen) searchRef.current?.focus();
      else setSearchOpen(true);
    },
    Escape: () => {
      if (searchOpen) closeSearch();
    },
    ...(results && results.length > 0 ? resultKeys : {}),
  });

  /** Scrolling the grid: the category whose heading has passed the top is the active one. */
  function spy() {
    const pane = dishPaneRef.current;
    if (!pane || jumping.current) return;
    const top = pane.getBoundingClientRect().top + 8;
    let current: string | null = null;
    for (const el of pane.querySelectorAll<HTMLElement>("[data-cat]")) {
      if (el.getBoundingClientRect().top <= top) current = el.dataset.cat ?? null;
      else break;
    }
    const id = current ?? railCategories[0]?.id;
    if (id && id !== activeCategory) setActiveCategory(id);
  }

  /**
   * A tile's tap: onto the ticket with the strip's rice and size, or the sheet
   * when a required choice is one the defaults do not cover. A size asked for
   * by the tile's corner chip always opens the sheet on that size.
   */
  function tapDish(item: MenuItem) {
    const quick = quickAdd(item, defaults);
    if (quick.kind === "add") {
      addLine(quick.line);
      setTileFlash((f) => ({ id: item.id, n: f.n + 1 }));
    } else {
      // Prefilled with what the defaults do cover (the rice), open on the
      // one choice they do not.
      setSheetItem({ item, sizeId: quick.sizeId, focus: quick.focus, initial: { modifierIds: quick.modifierIds } });
    }
  }

  /** The tile's 改 corner: the full sheet, on the choice a tap would ask for. */
  function modifyDish(item: MenuItem) {
    const quick = quickAdd(item, defaults);
    setSheetItem(
      quick.kind === "add"
        ? { item, sizeId: quick.line.sizeId, initial: { modifierIds: quick.line.modifierIds } }
        : { item, sizeId: quick.sizeId, focus: quick.focus, initial: { modifierIds: quick.modifierIds } },
    );
  }

  /**
   * 套用到全部: the strip's rice onto every line that has rice and offers it.
   * No confirm; the toast says how many changed and its Undo puts them back.
   */
  function applyRiceToAll() {
    const before = lines;
    let changed = 0;
    const after = lines.map((l) => {
      const item = index.get(l.itemId);
      const next = item ? withRice(item, l.sizeId, l.modifierIds, defaults.rice) : null;
      if (!next) return l;
      changed++;
      return { ...l, modifierIds: next };
    });
    if (changed > 0) setLines(after);
    toast(
      t("pos.updatedLines", { n: changed }),
      "info",
      changed > 0 ? { label: t("card.undo"), onAction: () => setLines(before) } : undefined,
    );
  }

  const linesRef = useRef<HTMLDivElement>(null);
  function addLine(draft: PosLineDraft, replace?: string) {
    const rest = replace ? lines.filter((l) => l.lineId !== replace) : lines;
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
    let flashId: string;
    if (same) {
      flashId = same.lineId;
      setLines(rest.map((l) => (l.lineId === same.lineId ? { ...l, quantity: Math.min(50, l.quantity + draft.quantity) } : l)));
    } else if (replace) {
      // An edited line keeps its place on the ticket.
      flashId = replace;
      setLines(lines.map((l) => (l.lineId === replace ? { ...draft, lineId: replace } : l)));
    } else {
      flashId = newKey();
      setLines([...rest, { ...draft, lineId: flashId }]);
    }
    setLineFlash((f) => ({ id: flashId, n: f.n + 1 }));
    setSheetItem(null);
    setPlaced(null);
    setError(null);
    // The newest line is the one to see.
    requestAnimationFrame(() => linesRef.current?.scrollTo({ top: linesRef.current.scrollHeight }));
  }

  /**
   * The line's + and −. Minus at 1 takes the line off with no confirm; the
   * toast's Undo puts it back where it was.
   */
  function setQty(lineId: string, quantity: number) {
    if (quantity >= 1) {
      setLines((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, quantity: Math.min(50, quantity) } : l)));
      return;
    }
    const at = lines.findIndex((l) => l.lineId === lineId);
    if (at < 0) return;
    const removed = lines[at];
    setLines(lines.filter((l) => l.lineId !== lineId));
    const item = index.get(removed.itemId);
    toast(t("pos.removedLine", { name: item?.nameZh ?? item?.nameEn ?? "" }), "info", {
      label: t("card.undo"),
      onAction: () =>
        setLines((prev) => (prev.some((l) => l.lineId === lineId) ? prev : [...prev.slice(0, at), removed, ...prev.slice(at)])),
    });
  }

  /** Tap a line: the sheet, on that line's own choices, to change it in place. */
  function editLine(line: TicketLine) {
    const item = index.get(line.itemId);
    if (!item) return;
    setSheetItem({
      item,
      sizeId: line.sizeId,
      replace: line.lineId,
      initial: { modifierIds: line.modifierIds, quantity: line.quantity, instructions: line.specialInstructions },
    });
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
    setScheduled("");
    setPaymentNote("");
    setStaffNote("");
    setLunchOverride(false);
    setIdempotencyKey(newKey());
    setReturning(null);
    setConfirmClear(false);
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
          channel,
          customer: {
            ...(name.trim() ? { name: name.trim() } : {}),
            ...(phone.trim() ? { phone: phone.trim() } : {}),
          },
          pickup: { time: scheduled || "asap" },
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

  const railRef = useRef<HTMLElement>(null);
  const linesBelow = useLinesBelow(linesRef, `.${s.line}`, [lines]);

  const tileLabels = { modify: t("pos.modify"), modifyShort: t("pos.modifyShort"), asks: t("pos.asks") };
  const tile = (item: MenuItem, hint: number | null = null) => {
    const disabledLabel = !isAvailable(item)
      ? t("pos.86d")
      : item.lunchSpecial === true && !lunchOpen
        ? t("pos.lunchClosed")
        : null;
    return (
      <DishTile
        key={item.id}
        item={item}
        tint={tintOf.get(item.id) ?? "sides"}
        count={onTicket.get(item.id) ?? 0}
        disabledLabel={disabledLabel}
        asks={quickAdd(item, defaults).kind === "ask"}
        flash={tileFlash.id === item.id ? tileFlash.n : 0}
        hint={hint}
        labels={tileLabels}
        onTap={() => tapDish(item)}
        onModify={() => modifyDish(item)}
      />
    );
  };

  const customerSummary = [name.trim(), phone.trim()].filter(Boolean).join(" · ");

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
        aria-describedby="pos-search-keys"
        enterKeyHint="search"
        ref={searchRef}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            // Esc clears the search; on an empty one it closes it.
            e.preventDefault();
            e.stopPropagation();
            if (query) setQuery("");
            else closeSearch();
          } else if (e.key === "Enter") {
            // Enter leaves the field with the results up, so 1 to 9 add one.
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      <span id="pos-search-keys" hidden>
        {t("pos.searchKeys")}
      </span>
      <button
        type="button"
        onClick={closeSearch}
        aria-label={t("pos.searchClose")}
        className={`${btn("quiet")} ${ui.icon}`}
      >
        <Icon name="x" size={24} />
      </button>
    </div>
  ) : null;

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
        {/* Phone or walk-in, strongest on the ticket. */}
        <span className={s.key}>{t(`channel.${channel}`)}</span>
        {/* Who it is for: a name if staff took one (optional), the phone a
            phone order needs, and the scheduled time if it has one. */}
        <button
          type="button"
          data-context="takeout"
          onClick={() => setDetailsOpen(true)}
          aria-label={t("pos.details.open", { summary: customerSummary || t(`channel.${channel}`) })}
          className={`${btn("secondary")} ${s.who}`}
        >
          {customerSummary ? (
            <span className={s.whoText}>
              {name.trim() && <span className={s.ctx}>{name.trim()}</span>}
              {phone.trim() && <span className={s.num}>{phone.trim()}</span>}
            </span>
          ) : (
            <>
              <span lang="zh-Hant" className={s.whoText}>
                {t("pos.addCustomerZh")}
              </span>
              <span lang="en" className={s.whoEn}>
                {t("pos.addCustomerEn")}
              </span>
            </>
          )}
          {scheduledLabel && <span className={`${s.num} ${s.when}`}>{t("pos.scheduledAt", { time: scheduledLabel })}</span>}
        </button>
        {(lines.length > 0 || customerSummary) && (
          <button
            type="button"
            aria-label={t("pos.clearOrder")}
            // Two taps, always: this one, then the confirm. Clearing a draft
            // throws away what the cashier just keyed in, so it is in the
            // same class as cancelling an order or clearing a table and takes
            // the same shared ConfirmDialog.
            onClick={() => setConfirmClear(true)}
            className={`${btn("quiet")} ${ui.icon}`}
          >
            <Icon name="trash" size={24} />
          </button>
        )}
      </div>
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
        const sizes = item ? itemSizes(item) : [];
        const size = sizes.find((x) => x.id === line.sizeId);
        // 飯 / size / choice: every choice staff made, 中文 first.
        const summary: string[] = [];
        const chosen = new Set(line.modifierIds);
        const rice = item?.modifierGroups.find((g) => g.id === RICE_GROUP_ID);
        for (const m of rice?.modifiers ?? []) if (chosen.has(m.id)) summary.push(m.nameZh ?? m.nameEn);
        if (size && sizes.length > 1) summary.push(resolveSizeZh(size.label) ?? size.label);
        for (const g of item?.modifierGroups ?? []) {
          if (g.id === RICE_GROUP_ID) continue;
          for (const m of g.modifiers) if (chosen.has(m.id)) summary.push(m.nameZh ?? m.nameEn);
        }
        const zhName = item?.nameZh ?? item?.nameEn ?? line.itemId;
        return (
          <div
            key={line.lineId}
            className={s.line}
            style={tintStyle(tintOf.get(line.itemId) ?? "sides")}
            data-line={line.lineId}
          >
            {lineFlash.id === line.lineId && lineFlash.n > 0 && (
              <span key={`flash-${lineFlash.n}`} aria-hidden="true" className={s.lineFlash} />
            )}
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={`${t("pos.editLine")} ${line.quantity} ${item?.nameZh ?? ""} ${item?.nameEn ?? ""} ${summary.join(" ")}`}
              onClick={() => editLine(line)}
              className={s.lineHit}
            >
              <span className={s.st} />
              <span className={s.lineText}>
                <span className={s.lineTop}>
                  <span lang={item?.nameZh ? "zh-Hant" : "en"} className={`${s.zh} ${s.one}`}>
                    <ZhName name={zhName} />
                  </span>
                  <span className={`${s.lp} ${s.num}`}>{formatCents(lineCents)}</span>
                </span>
                <span className={`${s.sub} ${s.one}`}>
                  {summary.length > 0 && (
                    <span lang="zh-Hant" className={s.opts}>
                      {summary.join(" / ")}
                    </span>
                  )}
                  {item?.nameZh && <span lang="en">{item.nameEn}</span>}
                </span>
                {line.specialInstructions && <span className={`${s.note} ${s.one}`}>{line.specialInstructions}</span>}
              </span>
            </button>
            <div className={s.stepper} role="group" aria-label={t("sheet.quantity")}>
              <button
                type="button"
                data-step="minus"
                aria-label={line.quantity > 1 ? t("pos.decrease") : t("pos.removeLine")}
                onClick={() => setQty(line.lineId, line.quantity - 1)}
              >
                <Icon name={line.quantity > 1 ? "minus" : "trash"} size={20} />
              </button>
              <span className={`${s.q} ${s.num}`} data-qty>
                {line.quantity}
              </span>
              <button
                type="button"
                data-step="plus"
                aria-label={t("pos.increase")}
                onClick={() => setQty(line.lineId, line.quantity + 1)}
              >
                <Icon name="plus" size={20} />
              </button>
            </div>
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
    <main className={s.root} data-pos-screen>
      {/* The POS's own controls, under the shared staff header: search, plus
          lunch hours when the clock has not opened lunch. */}
      <div className={s.top} role="toolbar" aria-label={t("pos.defaults")}>
        {searchField ?? (
          <>
            <div role="group" aria-label={t("pos.riceGroup")} className={`${ui.seg} ${s.defSeg}`} data-defaults="rice">
              {RICE_DEFAULTS.map((r) => (
                <button
                  key={r}
                  type="button"
                  data-value={r}
                  aria-pressed={defaults.rice === r}
                  aria-label={t(RICE_LABEL[r].all)}
                  title={t(RICE_LABEL[r].all)}
                  onClick={() => setRiceDefault(r)}
                >
                  <span lang="zh-Hant" className={s.zh}>
                    {t(RICE_LABEL[r].zh)}
                  </span>
                  <span lang="en" className={s.en}>
                    {t(RICE_LABEL[r].en)}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              data-action="apply-rice-all"
              onClick={applyRiceToAll}
              aria-label={t("pos.applyAll")}
              title={t("pos.applyAllHint")}
              className={s.applyAll}
            >
              <span lang="zh-Hant">{t("pos.applyAllZh")}</span>
              <span lang="en" className={s.en}>
                {t("pos.applyAllEn")}
              </span>
            </button>
            <div role="group" aria-label={t("pos.sizeGroup")} className={`${ui.seg} ${s.defSeg}`} data-defaults="size">
              {SIZE_DEFAULTS.map((z) => (
                <button
                  key={z}
                  type="button"
                  data-value={z}
                  aria-pressed={defaults.size === z}
                  aria-label={t(SIZE_LABEL[z].all)}
                  title={t(SIZE_LABEL[z].all)}
                  onClick={() => setSizeDefault(z)}
                >
                  <span lang="zh-Hant" className={s.zh}>
                    {t(SIZE_LABEL[z].zh)}
                  </span>
                  <span lang="en" className={s.en}>
                    {t(SIZE_LABEL[z].en)}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className={s.topRight}>
          {!lunchNow && (
            <button
              type="button"
              aria-pressed={lunchOverride}
              aria-label={t("pos.lunchHours")}
              title={t("pos.lunchOverrideHint")}
              onClick={() => setLunchOverride((v) => !v)}
              className={s.lunchBtn}
            >
              <Icon name="clock" size={18} />
              <span>{t("pos.lunchShort")}</span>
            </button>
          )}
          {!searchField && (
            <Button
              variant="secondary"
              size="sm"
              iconOnly
              icon="search"
              aria-label={t("pos.search")}
              onClick={() => setSearchOpen(true)}
            />
          )}
        </div>
      </div>

      {/* ---------------------------------------------- categories -- */}
      <nav ref={railRef} aria-label={t("pos.categories")} className={`${s.rail} ${s.scroll}`}>
        {railCategories.map((c) => {
          const l = categoryLook(c);
          return (
            <button
              key={c.id}
              type="button"
              data-cat-link={c.id}
              onClick={() => jumpTo(c)}
              aria-current={c.id === activeCategory && !results ? "true" : undefined}
              style={tintStyle(l.tint)}
            >
              <span className={s.sw} />
              <span lang={l.zh ? "zh-Hant" : "en"} className={s.zh}>
                {l.zh ?? l.en}
              </span>
              {l.zh && (
                <span lang="en" className={s.en}>
                  {l.en}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* -------------------------------------------------- dishes -- */}
      <section ref={dishPaneRef} onScroll={results ? undefined : spy} aria-label={t("pos.title")} className={`${s.dishes} ${s.scroll}`}>
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
              <div className={s.grid}>{results.map((item, i) => tile(item, i < 9 ? i + 1 : null))}</div>
            )}
          </>
        ) : (
          railCategories.map((category) => {
            const look = categoryLook(category);
            return (
              <section key={category.id} id={`pos-cat-${category.id}`} data-cat={category.id} className={s.catSection}>
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
                <div className={s.grid}>{category.items.map((item) => tile(item))}</div>
              </section>
            );
          })
        )}
      </section>

      {/* -------------------------------------------------- ticket -- */}
      <aside aria-label={t("pos.ticket")} className={s.ticket}>
        {ticketHead}
        <div ref={linesRef} className={`${s.lines} ${s.scroll}`}>
          {ticketLines}
        </div>
        {/* Its own row under the list, never over it: how many lines are
            below, and a tap scrolls to them. */}
        <div className={s.below}>
          {linesBelow > 0 && (
            <button
              type="button"
              data-action="more-lines"
              onClick={() => linesRef.current?.scrollBy({ top: linesRef.current.clientHeight * 0.75, behavior: "smooth" })}
              className={`${btn("quiet")} ${ui.sm}`}
            >
              {t("pos.moreLines", { n: linesBelow })}
            </button>
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

      {/* --------------------------------------- customer details + notes -- */}
      {detailsOpen && (
        <dialog
          ref={detailsRef}
          aria-label={t("pos.details.title")}
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
              <h2 className="text-[1.273rem] font-bold">{t("pos.details.title")}</h2>
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
                        <span className="text-staff-soft">{t("pos.returning")}</span>
                        {returningHere.name && <span className="font-semibold"> {returningHere.name}</span>}
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

              {/* Optional. Empty is ASAP and prints no time; a time set here
                  prints as 預訂 SCHEDULED under the phone number. */}
              <label>
                <span className={label}>{t("pos.scheduledFor")}</span>
                <select
                  value={scheduled}
                  onChange={(e) => setScheduled(e.target.value)}
                  data-field="scheduled"
                  className={field}
                >
                  <option value="">{t("pos.scheduledNone")}</option>
                  {scheduled !== "" && !scheduledLabel && (
                    // The chosen time has passed: keep it visible, unselectable.
                    <option value={scheduled} disabled>
                      {scheduled}
                    </option>
                  )}
                  {scheduledSlots.map((x) => (
                    <option key={x.value} value={x.value}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>

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
        <PosItemSheet
          key={`${sheetItem.item.id}:${sheetItem.sizeId ?? ""}:${sheetItem.replace ?? ""}`}
          item={sheetItem.item}
          initialSizeId={sheetItem.sizeId}
          initial={sheetItem.initial}
          editing={sheetItem.replace !== undefined}
          focus={sheetItem.focus}
          menuNumber={menuNumber(sheetItem.item.id)}
          onAdd={(draft) => addLine(draft, sheetItem.replace)}
          onClose={() => setSheetItem(null)}
        />
      )}
      {confirmClear && (
        <ConfirmDialog
          title={t("confirm.clearDraftTitle")}
          body={t("confirm.clearDraftBody")}
          confirmLabel={t("confirm.clearDraftConfirm")}
          onClose={() => setConfirmClear(false)}
          onConfirm={() => {
            resetTicket();
            setPlaced(null);
            setError(null);
          }}
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
