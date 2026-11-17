"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Menu, MenuItem } from "@/lib/menu/types";
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
import { POS_POPULAR_IDS } from "@/config/posPopular";
import {
  categoryLook,
  POPULAR_TAB_ID,
  POS_TABS,
  posName,
  tintStyle,
  type CategoryTint,
  type PosTab,
} from "@/lib/kitchen/posCategories";
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
import { NOTE_SEP, QUICK_NOTES, toggleNote } from "@/lib/kitchen/quickNotes";
import {
  hasBothSizes,
  riceLine,
  tapPlan,
  TRAY_SIZE_ID,
  type RiceChoice,
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
 * ticket's lines. Landscape: the nine tabs down the left, the dishes, and the
 * ticket at the right with its total and Send pinned at the bottom. Portrait
 * (an upright iPad): the tabs in one row under the header, the dishes three
 * a row, and the ticket as an 88px bar that opens a sheet (pos.module.css).
 * The search and lunch-hours buttons sit in the shell's header slot.
 *
 * NAMES, NOT DETAILS. A dish card is its 中文 and English on its category's
 * tint, nothing else: tap it and it goes on the ticket. A dish with rice asks
 * on the card (白飯 炒飯 各一半 無, as the dish offers them; a second tap takes
 * 白飯); a dish with any other required choice (a lunch entrée, an "or" dish,
 * a head count) opens the options sheet with that choice unmade: one tap
 * never decides for the caller. Prices are on the ticket. Tap a ticket line
 * for its quick notes and 改.
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

/** The rice picker's labels: 中文 over English, all three languages for assistive tech. */
const RICE_LABEL: Record<RiceChoice, { zh: KitchenKey; en: KitchenKey; all: KitchenKey }> = {
  steamed: { zh: "pos.riceSteamedZh", en: "pos.riceSteamedEn", all: "pos.riceSteamedAll" },
  fried: { zh: "pos.riceFriedZh", en: "pos.riceFriedEn", all: "pos.riceFriedAll" },
  half: { zh: "pos.riceHalfZh", en: "pos.riceHalfEn", all: "pos.riceHalfAll" },
  none: { zh: "pos.riceNoneZh", en: "pos.riceNoneEn", all: "pos.riceNoneAll" },
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
 * A dish card: 中文 over English on its category's tint, nothing else. The
 * card adds one; a dish that comes with rice opens the rice picker on the
 * card, and a second tap on the card takes 白飯. A dish sold as a tray too
 * carries a 餐盤 pill. Measures its own 中文 so a two-line name drops the
 * English to one.
 */
function DishTile({
  item,
  tileKey,
  tint,
  count,
  disabledLabel,
  asks,
  flash,
  hint,
  rice,
  labels,
  onTap,
  onTray,
  onRice,
}: {
  item: MenuItem;
  /** The card's own key: a dish can be on the screen twice (常點 and its own section). */
  tileKey: string;
  tint: CategoryTint;
  count: number;
  disabledLabel: string | null;
  /** The tap opens the sheet instead of adding. */
  asks: boolean;
  /** Bumped on each tap that added: replays the highlight. */
  flash: number;
  /** The number key that adds it (search results), if any. */
  hint: number | null;
  /** The rice picker is open on this card, with these choices. */
  rice: RiceChoice[] | null;
  labels: { asks: string; tray: string; trayAll: string; rice: string; riceAgain: string; riceAll: Record<RiceChoice, { zh: string; en: string; all: string }> };
  onTap: () => void;
  onTray: (() => void) | null;
  onRice: (choice: RiceChoice) => void;
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
  const shown = posName(item);
  const zhName = shown.zh ?? shown.en;
  const name = shown.zh ? `${shown.zh} ${shown.en}` : shown.en;
  return (
    <div
      ref={ref}
      style={tintStyle(tint)}
      data-tile={item.id}
      data-tile-key={tileKey}
      className={[s.tile, count > 0 && s.hasQ, onTray && !disabledLabel && s.hasTray, disabledLabel && s.off, rice && s.riceOpen]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        data-item={item.id}
        data-asks={asks || undefined}
        disabled={disabledLabel !== null}
        onClick={onTap}
        aria-expanded={rice ? true : undefined}
        aria-label={rice ? `${name} · ${labels.riceAgain}` : asks ? `${name} · ${labels.asks}` : name}
        className={s.tileMain}
      />
      {flash > 0 && <span key={`flash-${flash}`} aria-hidden="true" className={s.tapFlash} />}
      <span lang={shown.zh ? "zh-Hant" : "en"} className={s.zh}>
        {hint !== null && <span className={`${s.hint} ${s.num}`}>{hint}</span>}
        <ZhName name={zhName} />
      </span>
      {shown.zh && (
        <span lang="en" className={s.en}>
          {shown.en}
        </span>
      )}
      {asks && !disabledLabel && <span aria-hidden="true" title={labels.asks} className={s.asks} />}
      {count > 0 && (
        <span key={`qty-${count}`} data-qty-badge className={`${s.qtyBadge} ${s.num}`}>
          {count}
        </span>
      )}
      {disabledLabel && <span className={s.state}>{disabledLabel}</span>}
      {onTray && !disabledLabel && (
        <button type="button" data-tray={item.id} onClick={onTray} aria-label={`${labels.trayAll} ${name}`} className={s.trayPill}>
          <span lang="zh-Hant">{labels.tray}</span>
        </button>
      )}
      {rice && (
        <div role="group" aria-label={`${labels.rice} · ${name}`} data-rice-pop={item.id} className={s.ricePop}>
          {rice.map((r) => (
            <button
              key={r}
              type="button"
              data-rice={r}
              aria-label={labels.riceAll[r].all}
              onClick={() => onRice(r)}
              className={r === "steamed" ? s.riceDefault : undefined}
            >
              <span lang="zh-Hant" className={s.zh}>
                {labels.riceAll[r].zh}
              </span>
              <span lang="en" className={s.en}>
                {labels.riceAll[r].en}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The header slot the shell leaves for the screen's own controls (KitchenShell). */
function useHeaderSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a DOM node owned by the shell, found once
    setSlot(document.querySelector<HTMLElement>("[data-header-slot]"));
  }, []);
  return slot;
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
  /** Portrait: the ticket sheet over the dishes is open. */
  const [ticketOpen, setTicketOpen] = useState(false);
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
   * The nine tabs and the dishes in each, in one scroll. 常點 is the owner's
   * list; the lunch sets show only while lunch is open (by the clock or the
   * override), as they always have.
   */
  const sections = useMemo(() => {
    const byId = new Map(menu.categories.map((c) => [c.id, c]));
    return POS_TABS.map((tab) => {
      if (tab.id === POPULAR_TAB_ID) {
        const items = POS_POPULAR_IDS.map((id) => index.get(id)).filter((i): i is MenuItem => i !== undefined);
        return { tab, groups: [{ id: POPULAR_TAB_ID, zh: null as string | null, en: null as string | null, items }] };
      }
      const groups = tab.categories
        .filter((id) => id !== "lunch-specials" || lunchOpen)
        .map((id) => byId.get(id))
        .filter((c) => c !== undefined)
        .map((c) => {
          const look = categoryLook(c);
          return { id: c.id, zh: look.zh, en: c.nameEn, items: c.items };
        });
      return { tab, groups };
    });
  }, [menu, index, lunchOpen]);
  const [activeTab, setActiveTab] = useState<string>(POS_TABS[0].id);

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
  /** Set while the grid scrolls to a tab tap, so the spy does not fight it. */
  const jumping = useRef(false);
  function jumpTo(tab: PosTab) {
    setQuery("");
    setSearchOpen(false);
    setActiveTab(tab.id);
    setRicePick(null);
    jumping.current = true;
    // After the render that brings the sections back (if search was open).
    requestAnimationFrame(() => {
      const pane = dishPaneRef.current;
      const section = pane?.querySelector<HTMLElement>(`[data-cat="${tab.id}"]`);
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
   *   1-9   with search results up, tap that result (add it, or open its
   *         rice picker or sheet)
   */
  const resultKeys: Record<string, () => void> = {};
  for (let n = 1; n <= 9; n++) {
    resultKeys[String(n)] = () => {
      const item = results?.[n - 1];
      if (item && orderable(item)) tapDish(item, `r:${item.id}`);
    };
  }
  useShortcuts({
    "/": () => {
      if (searchOpen) searchRef.current?.focus();
      else setSearchOpen(true);
    },
    Escape: () => {
      if (ricePick) setRicePick(null);
      else if (ticketOpen) setTicketOpen(false);
      else if (searchOpen) closeSearch();
    },
    ...(results && results.length > 0 ? resultKeys : {}),
  });

  /** Scrolling the grid: the section whose heading has passed the top is the active tab. */
  function spy() {
    const pane = dishPaneRef.current;
    if (!pane || jumping.current) return;
    const top = pane.getBoundingClientRect().top + 8;
    let current: string | null = null;
    for (const el of pane.querySelectorAll<HTMLElement>("[data-cat]")) {
      if (el.getBoundingClientRect().top <= top) current = el.dataset.cat ?? null;
      else break;
    }
    const id = current ?? POS_TABS[0].id;
    if (id !== activeTab) setActiveTab(id);
  }

  /**
   * The rice picker open on one card: which card (a dish can show twice), the
   * size it is for, and the choices the dish offers.
   */
  const [ricePick, setRicePick] = useState<{ key: string; item: MenuItem; sizeId: string; options: RiceChoice[] } | null>(null);
  // A tap anywhere but the open card closes the picker.
  useEffect(() => {
    if (!ricePick) return;
    const onDown = (e: PointerEvent) => {
      const card = (e.target as Element | null)?.closest?.("[data-tile-key]");
      if (!card || (card as HTMLElement).dataset.tileKey !== ricePick.key) setRicePick(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [ricePick]);

  function flashTile(key: string) {
    setTileFlash((f) => ({ id: key, n: f.n + 1 }));
  }

  /**
   * A card's tap. Nothing to decide: onto the ticket. Only the rice to
   * decide: the picker on the card, and a second tap takes 白飯. Anything
   * else (an entrée, beef or chicken, a head count): the sheet, on that
   * choice. `sizeId` is the 餐盤 pill's tray.
   */
  function tapDish(item: MenuItem, key: string, sizeId?: string) {
    if (!sizeId && ricePick?.key === key) {
      addLine(riceLine(item, ricePick.sizeId, "steamed"));
      setRicePick(null);
      flashTile(key);
      return;
    }
    const plan = sizeId ? tapPlan(item, sizeId) : tapPlan(item);
    if (plan.kind === "add") {
      addLine(plan.line);
      setRicePick(null);
      flashTile(key);
    } else if (plan.kind === "rice") {
      setRicePick({ key, item, sizeId: plan.sizeId, options: plan.options });
    } else {
      setRicePick(null);
      setSheetItem({ item, sizeId: plan.sizeId, focus: plan.focus, initial: { modifierIds: plan.modifierIds } });
    }
  }

  function pickRice(choice: RiceChoice) {
    if (!ricePick) return;
    addLine(riceLine(ricePick.item, ricePick.sizeId, choice));
    flashTile(ricePick.key);
    setRicePick(null);
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

  /** The ticket line whose quick notes and 改 are showing. */
  const [openLine, setOpenLine] = useState<string | null>(null);

  /** 改: the sheet, on that line's own choices, to change it in place. */
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

  function noteLine(lineId: string, note: string) {
    setLines((prev) =>
      prev.map((l) => (l.lineId === lineId ? { ...l, specialInstructions: toggleNote(l.specialInstructions, note) } : l)),
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
      setTicketOpen(false);
      setOpenLine(null);
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

  const linesBelow = useLinesBelow(linesRef, `.${s.line}`, [lines, openLine]);
  const headerSlot = useHeaderSlot();

  const riceAll = Object.fromEntries(
    (Object.keys(RICE_LABEL) as RiceChoice[]).map((r) => [r, { zh: t(RICE_LABEL[r].zh), en: t(RICE_LABEL[r].en), all: t(RICE_LABEL[r].all) }]),
  ) as Record<RiceChoice, { zh: string; en: string; all: string }>;
  const tileLabels = {
    asks: t("pos.asks"),
    tray: t("pos.sizeTrayZh"),
    trayAll: t("pos.sizeTrayAll"),
    rice: t("pos.riceGroup"),
    riceAgain: t("pos.riceAgain"),
    riceAll,
  };
  const tile = (item: MenuItem, key: string, hint: number | null = null) => {
    const disabledLabel = !isAvailable(item)
      ? t("pos.86d")
      : item.lunchSpecial === true && !lunchOpen
        ? t("pos.lunchClosed")
        : null;
    return (
      <DishTile
        key={key}
        tileKey={key}
        item={item}
        tint={tintOf.get(item.id) ?? "sides"}
        count={onTicket.get(item.id) ?? 0}
        disabledLabel={disabledLabel}
        asks={tapPlan(item).kind === "ask"}
        flash={tileFlash.id === key ? tileFlash.n : 0}
        hint={hint}
        rice={ricePick?.key === key ? ricePick.options : null}
        labels={tileLabels}
        onTap={() => tapDish(item, key)}
        onTray={hasBothSizes(item) ? () => tapDish(item, key, TRAY_SIZE_ID) : null}
        onRice={pickRice}
      />
    );
  };

  const customerSummary = [name.trim(), phone.trim()].filter(Boolean).join(" · ");
  const itemCount = lines.reduce((n, l) => n + l.quantity, 0);

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

  /* ---- the POS's own header controls, in the shell's header slot ---- */
  const headerControls = (
    <>
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
      <Button
        variant={searchOpen ? "primary" : "secondary"}
        size="sm"
        iconOnly
        icon="search"
        aria-label={t("pos.search")}
        aria-pressed={searchOpen}
        onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
      />
    </>
  );

  /* ---- one slim line, only when something needs attention ---- */
  const statusLine = error ? (
    <p role="alert" className={`${s.statusLine} ${s.statusUrgent}`}>
      <Icon name="alert" size={20} />
      {error}
    </p>
  ) : notice ? (
    <p role="status" className={s.statusLine}>
      <Icon name="alert" size={20} />
      {notice}
    </p>
  ) : lunchOverride && !lunchNow ? (
    <p role="status" className={s.statusLine}>
      <Icon name="clock" size={20} />
      {t("pos.lunchOverrideWarning", lunchLabel)}
    </p>
  ) : null;

  /* ---- just sent: the number, and 重印 for two minutes ---- */
  const sentStatus = placed ? (
    <span role="status" className={s.sent}>
      <Icon name="check" size={22} />
      <span className={`${s.big} ${s.num}`}>{placed.orderNumber}</span>
      <span>{t("pos.sent")}</span>
    </span>
  ) : justNow ? (
    <span className={s.sent}>
      <span>
        {t("pos.justNow")} <span className={s.num}>{justNow.orderNumber}</span>
      </span>
    </span>
  ) : null;

  const ticketHead = (
    <div className={s.tHead}>
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
            // throws away what the cashier just keyed in, so it takes the
            // same shared ConfirmDialog as cancelling an order.
            onClick={() => setConfirmClear(true)}
            className={`${btn("quiet")} ${ui.icon}`}
          >
            <Icon name="trash" size={24} />
          </button>
        )}
        <button
          type="button"
          data-action="close-ticket"
          aria-label={t("pos.closeTicket")}
          onClick={() => setTicketOpen(false)}
          className={`${btn("quiet")} ${ui.icon} ${s.sheetOnly}`}
        >
          <Icon name="chevronDown" size={24} />
        </button>
      </div>
      {placed && (
        <div role="status" className={s.status}>
          <Icon name="check" size={24} />
          <span className={`${s.big} ${s.num}`}>{placed.orderNumber}</span>
          <span>{t("pos.sent")}</span>
        </div>
      )}
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
        const shown = item ? posName(item) : { zh: null, en: line.itemId };
        const zhName = shown.zh ?? shown.en;
        const open = openLine === line.lineId;
        const notes = new Set((line.specialInstructions ?? "").split(NOTE_SEP).map((n) => n.trim()));
        return (
          <div
            key={line.lineId}
            className={`${s.line} ${open ? s.lineOpen : ""}`}
            style={tintStyle(tintOf.get(line.itemId) ?? "sides")}
            data-line={line.lineId}
          >
            {lineFlash.id === line.lineId && lineFlash.n > 0 && (
              <span key={`flash-${lineFlash.n}`} aria-hidden="true" className={s.lineFlash} />
            )}
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${line.quantity} ${shown.zh ?? ""} ${shown.en} ${summary.join(" ")}`}
              onClick={() => setOpenLine(open ? null : line.lineId)}
              className={s.lineHit}
            >
              <span className={s.st} />
              <span className={s.lineText}>
                <span className={s.lineTop}>
                  <span lang={shown.zh ? "zh-Hant" : "en"} className={`${s.zh} ${s.one}`}>
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
                  {shown.zh && <span lang="en">{shown.en}</span>}
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
            {open && (
              <div className={s.lineMore} role="group" aria-label={t("pos.quickNotes")}>
                {QUICK_NOTES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    data-note={n}
                    aria-pressed={notes.has(n)}
                    onClick={() => noteLine(line.lineId, n)}
                    className={s.chip}
                  >
                    {n}
                  </button>
                ))}
                <button type="button" data-action="edit-line" onClick={() => editLine(line)} className={`${s.chip} ${s.chipEdit}`}>
                  <span lang="zh-Hant">{t("pos.modifyShort")}</span> {t("pos.editLineEn")}
                </button>
              </div>
            )}
          </div>
        );
      })
    );

  const sendLabel = submitting ? (
    t("pos.printing")
  ) : (
    <>
      <span lang="zh-Hant" className={s.zh}>
        {t("pos.sendZh")}
      </span>
      <span lang="en" className={s.en}>
        {t("pos.sendEn")}
      </span>
    </>
  );
  const missingNote = !error && lines.length > 0 && missing.length > 0 ? missing.map((k) => t(k)).join(" · ") : null;

  return (
    <main className={`${s.root} ${ticketOpen ? s.ticketIsOpen : ""}`} data-pos-screen>
      {headerSlot && createPortal(headerControls, headerSlot)}

      {statusLine && <div className={s.statusArea}>{statusLine}</div>}
      {searchField && <div className={s.searchArea}>{searchField}</div>}

      {/* ------------------------------------------------- the tabs -- */}
      <nav aria-label={t("pos.categories")} className={s.tabs}>
        {POS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-cat-link={tab.id}
            onClick={() => jumpTo(tab)}
            aria-current={tab.id === activeTab && !results ? "true" : undefined}
            aria-label={`${tab.zh} ${tab.enFull}`}
            style={tintStyle(tab.tint)}
          >
            <Icon name={tab.icon} size={22} />
            <span lang="zh-Hant" className={s.zh}>
              {tab.zh}
            </span>
            <span lang="en" className={s.en}>
              {tab.en}
            </span>
          </button>
        ))}
      </nav>

      {/* -------------------------------------------------- dishes -- */}
      <section ref={dishPaneRef} onScroll={results ? undefined : spy} aria-label={t("pos.title")} className={`${s.dishes} ${s.scroll}`}>
        {results ? (
          <>
            <h2 className={s.sectionH}>
              <span className={s.zh}>{t("pos.results")}</span>
            </h2>
            {results.length === 0 ? (
              <p className={s.emptyNote}>{t("pos.noResults", { q: query.trim() })}</p>
            ) : (
              <div className={s.grid}>{results.map((item, i) => tile(item, `r:${item.id}`, i < 9 ? i + 1 : null))}</div>
            )}
          </>
        ) : (
          sections.map(({ tab, groups }) => (
            <section key={tab.id} id={`pos-cat-${tab.id}`} data-cat={tab.id} className={s.catSection}>
              <h2 className={s.sectionH}>
                <span lang="zh-Hant" className={s.zh}>
                  {tab.zh}
                </span>
                <span lang="en" className={s.en}>
                  {tab.enFull}
                </span>
              </h2>
              {groups.map((g) => (
                <div key={g.id} data-group={g.id}>
                  {groups.length > 1 && (
                    <h3 className={s.subH}>
                      {g.zh && (
                        <span lang="zh-Hant" className={s.zh}>
                          {g.zh}
                        </span>
                      )}
                      <span lang="en" className={s.en}>
                        {g.en}
                      </span>
                      {g.id === "lunch-specials" && <span className={s.en}>· {t("pos.lunchWindow", lunchLabel)}</span>}
                    </h3>
                  )}
                  <div className={s.grid}>{g.items.map((item) => tile(item, `${tab.id}:${item.id}`))}</div>
                </div>
              ))}
            </section>
          ))
        )}
      </section>

      {/* -------------------------------------------------- ticket --
          Landscape: the side panel. Portrait: a sheet over the dishes,
          opened from the bar, at most 70% of the screen. */}
      {ticketOpen && (
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          className={s.scrim}
          onClick={() => setTicketOpen(false)}
        />
      )}
      <aside aria-label={t("pos.ticket")} className={s.ticket} data-ticket>
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
          {missingNote && <p className={s.alert}>{missingNote}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-action="print"
            className={`${ui.btn} ${canSubmit ? ui.primary : ""} ${s.print}`}
          >
            {sendLabel}
          </button>
        </div>
      </aside>

      {/* ------------------------------------- the bar (portrait) -- */}
      <div className={s.bar} data-ticket-bar>
        <button
          type="button"
          data-action="open-ticket"
          aria-expanded={ticketOpen}
          aria-label={ticketOpen ? t("pos.closeTicket") : t("pos.openTicket")}
          onClick={() => setTicketOpen((o) => !o)}
          className={s.barMain}
        >
          <span className={s.barWho}>
            <span className={s.key}>{t(`channel.${channel}`)}</span>
            <span className={`${s.barName} ${s.one}`}>
              {customerSummary || (
                <span className={s.soft}>
                  <span lang="zh-Hant">{t("pos.addCustomerZh")}</span>
                </span>
              )}
            </span>
          </span>
          {lines.length === 0 && sentStatus ? (
            sentStatus
          ) : (
            <span className={s.barSum}>
              <span className={`${s.barCount} ${s.num}`} data-item-count>
                {t("pos.items", { n: itemCount })}
              </span>
              <span className={`${s.barTotal} ${s.num}`}>{formatCents(total)}</span>
            </span>
          )}
          <Icon name="chevronDown" size={24} className={s.barChevron} />
        </button>
        {lines.length === 0 && justNow ? (
          <button type="button" onClick={() => reprint(justNow)} className={`${btn("secondary")} ${s.barSend}`}>
            <Icon name="printer" size={22} />
            {t("pos.reprint")}
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-action="send"
            title={missingNote ?? undefined}
            className={`${ui.btn} ${canSubmit ? ui.primary : ""} ${s.barSend}`}
          >
            {sendLabel}
          </button>
        )}
      </div>

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
