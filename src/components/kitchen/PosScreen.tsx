"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Menu, MenuCategory, MenuItem } from "@/lib/menu/types";
import { indexItems, isAvailable, itemSizes } from "@/lib/menu/types";
import { resolveLinePrice } from "@/lib/cart/pricing";
import { itemMatches, queryTerms } from "@/lib/menu/search";
import { formatCents, taxCents } from "@/lib/money";
import { formatPhoneAsTyped, formatPhoneNational, normalizePhone } from "@/lib/phone";
import { staffPickupSlots, clockLabel, type PickupOptions } from "@/lib/order/pickup";
import { isLunchService, LUNCH_END_MINUTES, LUNCH_START_MINUTES } from "@/lib/order/gates";
import { resolveSizeZh } from "@/data/menu-overrides";
import { RICE_GROUP_ID } from "@/lib/menu/rice";
import { menuNumber } from "@/data/menu-presentation";
import type { Order, OrderChannel, OrderLine, StaffChannel } from "@/lib/orders/types";
import { usePathname, useRouter } from "next/navigation";
import { diffOrderLines, isEmptyDiff, type OrderLinesDiff } from "@/lib/orders/revisionDiff";
import EditConfirmSheet, { type EditPreview } from "@/components/kitchen/EditConfirmSheet";
import type { Station } from "@/config/stations";
import { categoryLook, tintStyle, type CategoryTint } from "@/lib/kitchen/posCategories";
import { useKT } from "@/components/kitchen/KitchenI18n";
import PosItemSheet, { type PosLineDraft } from "@/components/kitchen/PosItemSheet";
import CustomChargeSheet, { type CustomChargeDraft } from "@/components/kitchen/CustomChargeSheet";
import {
  chargeNames,
  CUSTOM_ITEM_ID,
  CUSTOM_NAME_STORAGE_KEY,
  isCustomLine,
  SURCHARGE_MODIFIER_ID,
  type Surcharge,
} from "@/lib/kitchen/customCharge";
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
import { useSheetFocus } from "@/components/kitchen/ui/useSheetFocus";
import PortionSheet from "@/components/kitchen/PortionSheet";
import { lineAt, RICE_SIDE_ITEM_ID, RICE_SIDE_SIZE_ID, tapAsks, tapRule, type QuickLine } from "@/lib/kitchen/posTap";

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
 * tint, nothing else: tap a one-size dish and it goes on the ticket; tap a
 * dish sold in portions and the portion sheet asks 單點 / 半盤 / 餐盤, one tap.
 * A required choice the menu does not default (a lunch entrée, an "or" dish)
 * or a family dinner's head count opens the full sheet on it, unmade: one tap
 * never decides for the caller. Rice adds as 白飯, the menu's own default.
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
 * A dish tile. The body adds it, or opens the portion sheet for a dish sold
 * in portions; the 改 corner opens the full sheet. A dot marks a dish whose
 * tap opens the full sheet on a required choice (posTap.ts). Measures its own 中文 so a two-line name
 * drops the English to one.
 */
function DishTile({
  item,
  tint,
  count,
  disabledLabel,
  asks,
  portions,
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
  /** The tap opens the portion sheet (單點 / 半盤 / 餐盤). */
  portions: boolean;
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
    // The 中文 too: a count badge can wrap it without resizing the tile.
    const observer = new ResizeObserver(check);
    observer.observe(tile);
    observer.observe(zh);
    return () => observer.disconnect();
  }, []);
  const zhName = item.nameZh ?? item.nameEn;
  const name = item.nameZh ? `${item.nameZh} ${item.nameEn}` : item.nameEn;
  return (
    <div
      ref={ref}
      style={tintStyle(tint)}
      data-tile={item.id}
      className={[s.tile, count > 0 && s.hasQ, !disabledLabel && s.hasMod, asks && !disabledLabel && s.hasAsk, disabledLabel && s.off]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        data-item={item.id}
        data-asks={asks || undefined}
        data-portions={portions || undefined}
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

/**
 * 自訂 Custom: the tile that opens the custom charge sheet. Pinned first in
 * 招牌菜 Specials and found by searching "custom". Drawn like a dish tile, on
 * the panel colour with a dashed lacquer edge, so it never reads as a dish.
 */
function CustomTile({ labels, onTap }: { labels: { zh: string; en: string; all: string }; onTap: () => void }) {
  return (
    <div data-tile={CUSTOM_ITEM_ID} className={`${s.tile} ${s.customTile}`}>
      <button type="button" data-custom-tile onClick={onTap} aria-label={labels.all} className={s.tileMain} />
      <span lang="zh-Hant" className={s.zh}>
        <Icon name="plus" size={20} className={s.customPlus} />
        {labels.zh}
      </span>
      <span lang="en" className={s.en}>
        {labels.en}
      </span>
    </div>
  );
}

/**
 * 改單: a stored order as POS lines. Every line keeps its place and is tagged
 * `orig:<index>`, which is how the server knows to keep its stored price
 * (lib/orders/editPricing.ts); a custom charge and a 加價 come back as the
 * POS drew them.
 */
function draftsFromOrder(order: Order): TicketLine[] {
  return order.items.map((line, i) => {
    const lineId = `orig:${i}`;
    if (isCustomLine(line)) {
      return {
        lineId,
        itemId: CUSTOM_ITEM_ID,
        sizeId: "regular",
        modifierIds: [],
        quantity: line.quantity,
        specialInstructions: line.specialInstructions,
        custom: { name: line.nameZh ? `${line.nameZh} ${line.nameEn}` : line.nameEn, amountCents: line.unitCents },
      };
    }
    const charge = line.modifiers.find((m) => m.id === SURCHARGE_MODIFIER_ID);
    return {
      lineId,
      itemId: line.itemId,
      sizeId: line.sizeId,
      modifierIds: line.modifiers.filter((m) => m.id !== SURCHARGE_MODIFIER_ID).map((m) => m.id),
      quantity: line.quantity,
      specialInstructions: line.specialInstructions,
      ...(charge
        ? { surcharge: { amountCents: charge.priceCents, label: charge.nameZh ? `${charge.nameZh} ${charge.nameEn}` : charge.nameEn } }
        : {}),
    };
  });
}

/** Enough of an OrderLine for the diff: the identity of each POS line, no prices. */
function diffShape(lines: readonly TicketLine[]): OrderLine[] {
  return lines.map((l) => ({
    itemId: l.custom ? CUSTOM_ITEM_ID : l.itemId,
    nameEn: l.custom ? l.custom.name : l.itemId,
    nameZh: null,
    sizeId: l.sizeId,
    sizeLabel: "",
    sizeLabelZh: null,
    modifiers: [...l.modifierIds, ...(l.surcharge ? [`${SURCHARGE_MODIFIER_ID}:${l.surcharge.amountCents}`] : [])].map((id) => ({
      id,
      nameEn: id,
      nameZh: null,
      priceCents: 0,
    })),
    quantity: l.quantity,
    unitCents: l.custom ? l.custom.amountCents : 0,
    lineCents: 0,
    specialInstructions: l.specialInstructions,
    ...(l.custom ? { custom: true as const } : {}),
  }));
}

/** The request lines, as both a new order and an edit send them (never a price). */
function requestLines(lines: readonly TicketLine[], withIds: boolean) {
  return lines.map((l) => ({
    ...(withIds && l.lineId.startsWith("orig:") ? { lineId: l.lineId } : {}),
    ...(l.custom
      ? {
          custom: true as const,
          name: l.custom.name,
          amountCents: l.custom.amountCents,
          quantity: l.quantity,
          ...(l.specialInstructions ? { specialInstructions: l.specialInstructions } : {}),
        }
      : {
          itemId: l.itemId,
          sizeId: l.sizeId,
          modifierIds: l.modifierIds,
          quantity: l.quantity,
          ...(l.specialInstructions ? { specialInstructions: l.specialInstructions } : {}),
          ...(l.surcharge ? { surcharge: l.surcharge } : {}),
        }),
  }));
}

export default function PosScreen({
  menu,
  taxRateBps,
  pickupOptions,
  asIfOpen,
  editOrder = null,
  editRefused = false,
}: {
  menu: Menu;
  taxRateBps: number | null;
  pickupOptions: PickupOptions;
  /** Test-mode session: show pickup times as if the store were open. */
  asIfOpen: boolean;
  /**
   * 改單 EDIT MODE (docs/edit-order.md): the order being edited, loaded by the
   * page. The ticket starts as its lines; customer, channel and pickup are
   * shown and cannot change; Print becomes Save & print changes.
   */
  editOrder?: Order | null;
  /** ?edit= named an order that cannot be edited (cancelled, done too long ago, gone). */
  editRefused?: boolean;
}) {
  const t = useKT();
  const router = useRouter();
  const pathname = usePathname();
  /** Where the board is: this screen is `<board>/pos`. */
  const boardPath = pathname.replace(/\/pos\/?$/, "") || "/";
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
  const editing = editOrder;
  const original = useMemo(() => (editing ? draftsFromOrder(editing) : []), [editing]);
  const [lines, setLines] = useState<TicketLine[]>(original);
  const [name, setName] = useState(editing?.customer.name ?? "");
  // An edited order's phone is shown, never sent: as staff read it, not E.164.
  const [phone, setPhone] = useState(editing?.customer.phone ? formatPhoneNational(editing.customer.phone) : "");
  const [channel, setChannel] = useState<StaffChannel>(
    editing && (editing.channel === "phone" || editing.channel === "walk_in") ? editing.channel : "phone",
  );
  /** The channel the header names: an edited web order stays a web order. */
  // (A retired dine_in row reads as the store order it now is.)
  const shownChannel: Exclude<OrderChannel, "dine_in"> = editing
    ? editing.channel === "dine_in"
      ? "walk_in"
      : editing.channel
    : channel;
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

  // The rice and size strip is gone (docs/kitchen-design.md, Revision 3).
  // Its per-tablet choices are dropped once, so nothing stale lingers.
  useEffect(() => {
    try {
      localStorage.removeItem("nmc-pos-rice");
      localStorage.removeItem("nmc-pos-size");
    } catch {
      /* storage blocked: nothing to clear */
    }
  }, []);
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
        // A custom line is its own typed price; a dish is the menu's, plus
        // any 加價 per unit. The server does the same sum.
        if (line.custom) return { line, item: undefined, lineCents: line.custom.amountCents * line.quantity };
        const item = index.get(line.itemId);
        let lineCents = 0;
        try {
          if (item) lineCents = resolveLinePrice(item, line.sizeId, line.modifierIds, line.quantity).lineCents;
        } catch {
          lineCents = 0;
        }
        if (item && line.surcharge) lineCents += line.surcharge.amountCents * line.quantity;
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
  if (lines.length === 0) missing.push(editing ? "edit.emptyLines" : "pos.missing.lines");
  if (!editing && channel === "phone" && !phoneE164) missing.push("pos.missing.phone");
  if (!editing && now && !scheduledOk) missing.push("pos.missing.scheduled");
  /* 改單: what moved, against the order as loaded. Same diff the server
     prints from, on the lines' identities (the server re-prices). */
  const editDiff: OrderLinesDiff | null = useMemo(
    () => (editing ? diffOrderLines(diffShape(original), diffShape(lines)) : null),
    [editing, original, lines],
  );
  const dirty = editDiff !== null && !isEmptyDiff(editDiff);
  if (editing && lines.length > 0 && !dirty) missing.push("edit.noChanges");
  const canSubmit = editing
    ? lines.length > 0 && dirty && !submitting && taxRateBps != null
    : missing.length === 0 && !submitting && taxRateBps != null && !phoneBad && now !== null;
  /** How each line differs from the order being edited, for its tag. */
  const lineTags = useMemo(() => {
    const tags = new Map<string, KitchenKey | { qty: [number, number] }>();
    if (!editing) return tags;
    const byId = new Map(original.map((l) => [l.lineId, l]));
    const same = (a: TicketLine, b: TicketLine) =>
      JSON.stringify(diffShape([{ ...a, quantity: 1 }])) === JSON.stringify(diffShape([{ ...b, quantity: 1 }]));
    for (const line of lines) {
      const was = byId.get(line.lineId);
      if (!was) tags.set(line.lineId, "edit.tagNew");
      else if (!same(was, line)) tags.set(line.lineId, "edit.tagChanged");
      else if (was.quantity !== line.quantity) tags.set(line.lineId, { qty: [was.quantity, line.quantity] });
    }
    return tags;
  }, [editing, original, lines]);

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
    initial?: { modifierIds?: readonly string[]; quantity?: number; instructions?: string; surcharge?: Surcharge };
  } | null>(null);
  /** The dish whose portion sheet is open. */
  const [portionItem, setPortionItem] = useState<MenuItem | null>(null);
  /** The portion last picked on THIS ticket: the sheet's highlight, never a default. */
  const [lastPortion, setLastPortion] = useState("individual");
  /** 自訂 Custom: the sheet's starting values, and the line it replaces. */
  const [customSheet, setCustomSheet] = useState<{ initial: CustomChargeDraft; replace?: string } | null>(null);
  /** The tile just tapped, and a counter that replays its highlight. */
  const [tileFlash, setTileFlash] = useState<{ id: string; n: number }>({ id: "", n: 0 });
  /** The ticket line just added or bumped, likewise. */
  const [lineFlash, setLineFlash] = useState<{ id: string; n: number }>({ id: "", n: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** Portrait: the ticket sheet is open over the dishes. */
  const [ticketOpen, setTicketOpen] = useState(false);
  const ticketRef = useRef<HTMLElement>(null);
  // The sheet keeps the keyboard while it is open, like every other sheet.
  useSheetFocus(ticketRef, () => setTicketOpen(false), (panel) => panel.querySelector<HTMLElement>("[data-action=close-ticket]"), ticketOpen);
  // Turned to landscape with the sheet open: the ticket is a column again.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1000px)");
    const onChange = () => {
      if (wide.matches) setTicketOpen(false);
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);
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

  /** The custom tile answers a search for it, in either language. */
  const customMatch = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q.length >= 2 && ("custom".startsWith(q) || q.includes("custom") || t("pos.custom.zh").includes(q));
  }, [query, t]);

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
   *   1-9   with search results up, tap that result (add it, or open its
   *         portion or full sheet)
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
   * A tile's tap (posTap.ts): a one-size dish goes straight on the ticket; a
   * dish sold in portions opens the portion sheet, where one tap picks the
   * size and adds; any other required choice opens the full sheet on it.
   */
  function tapDish(item: MenuItem) {
    const tap = tapRule(item);
    if (tap.kind === "portion") setPortionItem(item);
    else settle(item, tap);
  }

  /** Add a line the rule could finish, or open the full sheet on what it could not. */
  function settle(item: MenuItem, tap: ReturnType<typeof lineAt>) {
    if (tap.kind === "add") {
      addLine(tap.line);
      setTileFlash((f) => ({ id: item.id, n: f.n + 1 }));
    } else if (tap.kind === "ask") {
      setSheetItem({ item, sizeId: tap.sizeId, focus: tap.focus, initial: { modifierIds: tap.modifierIds } });
    }
  }

  /** The portion sheet's tap: that size, remembered for this ticket's next highlight. */
  function pickPortion(item: MenuItem, sizeId: string) {
    setPortionItem(null);
    setLastPortion(sizeId);
    settle(item, lineAt(item, sizeId));
  }

  /**
   * The tile's 改 corner: the full sheet, on the portion last chosen on this
   * ticket when the dish has it, with the rice the tap would have used.
   */
  function modifyDish(item: MenuItem) {
    const sizes = itemSizes(item);
    const sizeId = sizes.some((x) => x.id === lastPortion) ? lastPortion : sizes[0]?.id;
    if (!sizeId) return;
    const tap = lineAt(item, sizeId);
    setSheetItem(
      tap.kind === "add"
        ? { item, sizeId, initial: { modifierIds: tap.line.modifierIds } }
        : tap.kind === "ask"
          ? { item, sizeId, focus: tap.focus, initial: { modifierIds: tap.modifierIds } }
          : { item, sizeId },
    );
  }

  /**
   * Rice the dish does not include is the real menu item #116 炒飯／白飯
   * Fried/Steamed Rice at 單點, steamed, as its own line: never a surcharge.
   * Null when the menu lacks it or it is 86'd (no 加飯 button, no 加飯 row).
   */
  const riceSide = useMemo((): QuickLine | null => {
    const item = index.get(RICE_SIDE_ITEM_ID);
    if (!item || !isAvailable(item)) return null;
    const tap = lineAt(item, RICE_SIDE_SIZE_ID);
    return tap.kind === "add" ? tap.line : null;
  }, [index]);
  const riceSideCents = useMemo(() => {
    const item = index.get(RICE_SIDE_ITEM_ID);
    if (!item || !riceSide) return 0;
    try {
      return resolveLinePrice(item, riceSide.sizeId, riceSide.modifierIds, 1).lineCents;
    } catch {
      return 0;
    }
  }, [index, riceSide]);

  const linesRef = useRef<HTMLDivElement>(null);
  /**
   * Put a line on the ticket (or change one in place), and `extraRice` × #116
   * as its own line after it: the 改 sheet's 加飯 row and the footer's 加飯.
   */
  function addLine(draft: PosLineDraft, replace?: string, extraRice = 0) {
    let { list, id: flashId } = mergeLine(lines, draft, replace);
    if (extraRice > 0 && riceSide) ({ list, id: flashId } = mergeLine(list, { ...riceSide, quantity: extraRice }));
    setLines(list);
    setLineFlash((f) => ({ id: flashId, n: f.n + 1 }));
    setSheetItem(null);
    setPlaced(null);
    setError(null);
    // The newest line is the one to see.
    requestAnimationFrame(() => linesRef.current?.scrollTo({ top: linesRef.current.scrollHeight }));
  }

  function mergeLine(lines: TicketLine[], draft: PosLineDraft, replace?: string): { list: TicketLine[]; id: string } {
    const rest = replace ? lines.filter((l) => l.lineId !== replace) : lines;
    // Same dish, same choices, no note: bump the quantity rather than add a
    // second identical row the kitchen has to sum.
    const same = rest.find(
      (l) =>
        !l.specialInstructions &&
        !draft.specialInstructions &&
        !l.custom &&
        !draft.custom &&
        !l.surcharge &&
        !draft.surcharge &&
        l.itemId === draft.itemId &&
        l.sizeId === draft.sizeId &&
        [...l.modifierIds].sort().join() === [...draft.modifierIds].sort().join(),
    );
    if (same) {
      return {
        id: same.lineId,
        list: rest.map((l) => (l.lineId === same.lineId ? { ...l, quantity: Math.min(50, l.quantity + draft.quantity) } : l)),
      };
    }
    // An edited line keeps its place on the ticket.
    if (replace) return { id: replace, list: lines.map((l) => (l.lineId === replace ? { ...draft, lineId: replace } : l)) };
    const id = newKey();
    return { id, list: [...rest, { ...draft, lineId: id }] };
  }

  /** The footer's 加飯: one #116 line, 單點 steamed; again bumps it. Fried is the line's 改. */
  function addRiceSide() {
    if (!riceSide) return;
    addLine(riceSide);
    setTileFlash((f) => ({ id: RICE_SIDE_ITEM_ID, n: f.n + 1 }));
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
    const removedName = removed.custom ? removed.custom.name : (item?.nameZh ?? item?.nameEn ?? "");
    toast(t("pos.removedLine", { name: removedName }), "info", {
      label: t("card.undo"),
      onAction: () =>
        setLines((prev) => (prev.some((l) => l.lineId === lineId) ? prev : [...prev.slice(0, at), removed, ...prev.slice(at)])),
    });
  }

  /** Tap a line: the sheet, on that line's own choices, to change it in place. */
  function editLine(line: TicketLine) {
    if (line.custom) {
      setCustomSheet({
        replace: line.lineId,
        initial: {
          name: line.custom.name,
          amountCents: line.custom.amountCents,
          quantity: line.quantity,
          specialInstructions: line.specialInstructions,
        },
      });
      return;
    }
    const item = index.get(line.itemId);
    if (!item) return;
    setSheetItem({
      item,
      sizeId: line.sizeId,
      replace: line.lineId,
      initial: {
        modifierIds: line.modifierIds,
        quantity: line.quantity,
        instructions: line.specialInstructions,
        surcharge: line.surcharge,
      },
    });
  }

  /** 自訂 Custom: the sheet, on the last name this tablet used. */
  function openCustom() {
    let name = "";
    try {
      name = localStorage.getItem(CUSTOM_NAME_STORAGE_KEY) ?? "";
    } catch {
      /* storage blocked: start blank */
    }
    setCustomSheet({ initial: { name, amountCents: 0, quantity: 1 } });
  }

  function addCustom(draft: CustomChargeDraft, replace?: string) {
    try {
      localStorage.setItem(CUSTOM_NAME_STORAGE_KEY, draft.name);
    } catch {
      /* the name is a convenience */
    }
    setCustomSheet(null);
    addLine(
      {
        itemId: CUSTOM_ITEM_ID,
        sizeId: "regular",
        modifierIds: [],
        quantity: draft.quantity,
        specialInstructions: draft.specialInstructions,
        custom: { name: draft.name, amountCents: draft.amountCents },
      },
      replace,
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
      if (isCustomLine(line)) {
        drafts.push({
          lineId: newKey(),
          itemId: CUSTOM_ITEM_ID,
          sizeId: "regular",
          modifierIds: [],
          quantity: line.quantity,
          specialInstructions: line.specialInstructions,
          custom: {
            name: line.nameZh ? `${line.nameZh} ${line.nameEn}` : line.nameEn,
            amountCents: line.unitCents,
          },
        });
        continue;
      }
      const item = index.get(line.itemId);
      const charge = line.modifiers.find((m) => m.id === SURCHARGE_MODIFIER_ID);
      const modifierIds = line.modifiers.filter((m) => m.id !== SURCHARGE_MODIFIER_ID).map((m) => m.id);
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
        ...(charge
          ? {
              surcharge: {
                amountCents: charge.priceCents,
                label: charge.nameZh ? `${charge.nameZh} ${charge.nameEn}` : charge.nameEn,
              },
            }
          : {}),
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
    setLastPortion("individual");
    setIdempotencyKey(newKey());
    setReturning(null);
    setConfirmClear(false);
    setNotice(null);
  }

  /* ---------------------------------------------------- 改單 save -- */
  const [confirmEdit, setConfirmEdit] = useState<{ preview: EditPreview | null; token: string } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editConflict, setEditConflict] = useState(false);
  const [printChange, setPrintChange] = useState(false);
  const editDone = editing?.status === "COMPLETED";

  function editErrorText(code: string | undefined, detail?: string): string {
    if (code === "rejected") return t("edit.error.rejected", { detail: detail ?? "" });
    const known = [
      "conflict", "change_printing", "not_editable", "not_found", "no_changes", "empty",
      "item_unavailable", "bad_request", "unauthorized", "unavailable", "network", "rate",
    ];
    return t(`edit.error.${known.includes(code ?? "") ? code : "unavailable"}` as KitchenKey);
  }

  async function postEdit(token: string, dryRun: boolean) {
    if (!editing) return null;
    const res = await fetch(`/api/kitchen/orders/${editing.id}/edit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseRevision: editing.revision,
        editToken: token,
        lines: requestLines(lines, true),
        ...(lunchOverride && hasLunchLine && !lunchNow ? { lunchOverride: true } : {}),
        ...(editDone && printChange ? { printChange: true } : {}),
        ...(dryRun ? { dryRun: true } : {}),
      }),
    });
    if (res.status === 429) return { ok: false as const, code: "rate" };
    return (await res.json()) as {
      ok: boolean;
      code?: string;
      error?: string;
      diff?: OrderLinesDiff;
      totals?: { totalCents: number };
      oldTotals?: { totalCents: number };
      print?: EditPreview["print"];
    };
  }

  /** Save: the server's dry run first, shown in the confirm sheet. */
  async function openEditConfirm() {
    if (!canSubmit || !editing) return;
    // One token per confirm sheet: a double tap on its Save is one edit.
    const token = newKey();
    setEditError(null);
    setEditConflict(false);
    setConfirmEdit({ preview: null, token });
    try {
      const data = await postEdit(token, true);
      if (!data?.ok || !data.diff || !data.totals || !data.oldTotals || !data.print) {
        setEditError(editErrorText(data?.code, data?.error));
        setEditConflict(data?.code === "conflict");
        return;
      }
      setConfirmEdit({
        token,
        preview: {
          diff: data.diff,
          oldTotalCents: data.oldTotals.totalCents,
          newTotalCents: data.totals.totalCents,
          print: data.print,
        },
      });
    } catch {
      setEditError(t("edit.error.network"));
    }
  }

  async function saveEdit() {
    if (!editing || !confirmEdit?.preview) return;
    setSubmitting(true);
    setEditError(null);
    try {
      const data = await postEdit(confirmEdit.token, false);
      if (!data?.ok) {
        setEditError(editErrorText(data?.code, data?.error));
        setEditConflict(data?.code === "conflict");
        return;
      }
      toast(t("edit.saved", { number: editing.orderNumber }), "info");
      void refreshLive();
      setConfirmEdit(null);
      router.push(boardPath);
    } catch {
      setEditError(t("edit.error.network"));
    } finally {
      setSubmitting(false);
    }
  }

  function cancelEditing() {
    router.push(boardPath);
  }

  async function submit() {
    if (editing) {
      void openEditConfirm();
      return;
    }
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/kitchen/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lines: requestLines(lines, false),
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
  /* The category row follows the dishes: whichever category is current is
     scrolled into view on the rail, sideways on the landscape chip row and
     up or down on the portrait rail. */
  useEffect(() => {
    const rail = railRef.current;
    const chip = rail?.querySelector<HTMLElement>(`[data-cat-link="${activeCategory}"]`);
    if (!rail || !chip) return;
    if (rail.scrollWidth > rail.clientWidth) {
      const left = chip.offsetLeft - (rail.clientWidth - chip.offsetWidth) / 2;
      rail.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
    } else if (rail.scrollHeight > rail.clientHeight) {
      const top = chip.offsetTop - (rail.clientHeight - chip.offsetHeight) / 2;
      rail.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }
  }, [activeCategory]);
  const linesBelow = useLinesBelow(linesRef, `.${s.line}`, [lines]);

  const tileLabels = { modify: t("pos.modify"), modifyShort: t("pos.modifyShort"), asks: t("pos.asks") };
  const customLabels = { zh: t("pos.custom.zh"), en: t("pos.custom.tileEn"), all: t("pos.custom.title") };
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
        asks={tapAsks(item)}
        portions={tapRule(item).kind === "portion"}
        flash={tileFlash.id === item.id ? tileFlash.n : 0}
        hint={hint}
        labels={tileLabels}
        onTap={() => tapDish(item)}
        onModify={() => modifyDish(item)}
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
      {editing && (
        <div className={s.editHead} data-edit-head>
          <span className={s.editTitle}>
            <span lang="zh-Hant" className={`${s.zh} ${s.num}`}>
              {t("edit.titleZh", { number: editing.orderNumber })}
            </span>
            <span className={s.en}>{t("edit.titleEn")}</span>
          </span>
          <button type="button" data-action="cancel-edit" onClick={cancelEditing} className={`${btn("secondary")} ${s.editCancel}`}>
            <span lang="zh-Hant" className={s.zh}>
              {t("edit.cancelZh")}
            </span>
            <span lang="en" className={s.en}>
              {t("edit.cancelEn")}
            </span>
          </button>
        </div>
      )}
      {editRefused && (
        <p role="alert" className={s.status}>
          {t("edit.notEditable")}
        </p>
      )}
      <div className={s.tRow}>
        {/* Phone or walk-in, strongest on the ticket. */}
        <span className={s.key}>{t(`channel.${shownChannel}`)}</span>
        {editing ? (
          <span className={s.who} data-customer-locked title={t("edit.customerLocked")} aria-label={t("edit.customerLocked")}>
            <span className={s.whoText}>
              {name.trim() && <span className={s.ctx}>{name.trim()}</span>}
              {phone.trim() && <span className={s.num}>{phone.trim()}</span>}
            </span>
          </span>
        ) : (
          <>
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
          </>
        )}
        {!editing && (lines.length > 0 || customerSummary) && (
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
        if (line.surcharge) summary.push(`+${formatCents(line.surcharge.amountCents)} ${line.surcharge.label}`);
        const custom = line.custom ? chargeNames(line.custom.name) : null;
        const shown = custom
          ? { zh: custom.nameZh, en: custom.nameEn }
          : { zh: item?.nameZh ?? null, en: item?.nameEn ?? line.itemId };
        const zhName = shown.zh ?? shown.en;
        return (
          <div
            key={line.lineId}
            className={s.line}
            style={tintStyle(tintOf.get(line.itemId) ?? "sides")}
            data-line={line.lineId}
            data-custom={line.custom ? true : undefined}
          >
            {lineFlash.id === line.lineId && lineFlash.n > 0 && (
              <span key={`flash-${lineFlash.n}`} aria-hidden="true" className={s.lineFlash} />
            )}
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={`${t("pos.editLine")} ${line.quantity} ${shown.zh ?? ""} ${shown.en} ${summary.join(" ")}`}
              onClick={() => editLine(line)}
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
                  {lineTags.has(line.lineId) && (
                    <span data-edit-tag className={`${s.editTag} ${lineTags.get(line.lineId) === "edit.tagNew" ? s.editTagNew : ""}`}>
                      {(() => {
                        const tag = lineTags.get(line.lineId)!;
                        return typeof tag === "string" ? t(tag) : t("edit.tagQty", { from: tag.qty[0], to: tag.qty[1] });
                      })()}
                    </span>
                  )}
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
          </div>
        );
      })
    );

  const printLabel = editing ? (
    <span className={s.editSave}>
      <span lang="zh-Hant" className={s.zh}>
        {t("edit.saveZh")}
      </span>
      <span lang="en" className={s.en}>
        {lines.length === 0 ? t("edit.emptyLines") : dirty ? t("edit.saveEn") : t("edit.noChanges")}
      </span>
    </span>
  ) : submitting ? (
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
    <main className={`${s.root} ${ticketOpen ? s.ticketIsOpen : ""} ${searchOpen ? s.searchIsOpen : ""}`} data-pos-screen>
      {/* The POS's own controls, under the shared staff header: search, plus
          lunch hours when the clock has not opened lunch. */}
      <div className={s.top} role="toolbar" aria-label={t("pos.toolbar")}>
        {searchField}
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
            {results.length === 0 && !customMatch ? (
              <p className={s.emptyNote}>{t("pos.noResults", { q: query.trim() })}</p>
            ) : (
              <div className={s.grid}>
                {customMatch && <CustomTile labels={customLabels} onTap={openCustom} />}
                {results.map((item, i) => tile(item, i < 9 ? i + 1 : null))}
              </div>
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
                <div className={s.grid}>
                  {category.id === "specials" && <CustomTile labels={customLabels} onTap={openCustom} />}
                  {category.items.map((item) => tile(item))}
                </div>
              </section>
            );
          })
        )}
      </section>

      {/* -------------------------------------------------- ticket --
          Landscape: the 340px column. Portrait: a sheet from the bottom,
          opened from the bar below. */}
      {ticketOpen && (
        <button type="button" aria-hidden="true" tabIndex={-1} className={s.scrim} onClick={() => setTicketOpen(false)} />
      )}
      <aside
        ref={ticketRef}
        aria-label={t("pos.ticket")}
        className={s.ticket}
        data-ticket
        {...(ticketOpen ? { role: "dialog", "aria-modal": true } : {})}
      >
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
          {editing && (
            <p className={`${s.was} ${s.num}`} data-was-total>
              {t("edit.was", { total: formatCents(editing.totals.totalCents) })}
            </p>
          )}
          {error && (
            <p role="alert" className={s.alert}>
              {error}
            </p>
          )}
          {!error && !editing && lines.length > 0 && missing.length > 0 && (
            <p className={s.alert}>{missing.map((k) => t(k)).join(" · ")}</p>
          )}
          <div className={s.footRow}>
            {riceSide && (
              <button
                type="button"
                onClick={addRiceSide}
                data-action="add-rice"
                aria-label={t("pos.addRiceAria", { price: formatCents(riceSideCents) })}
                title={t("pos.addRiceAria", { price: formatCents(riceSideCents) })}
                className={s.addRice}
              >
                <span lang="zh-Hant" className={s.zh}>
                  {t("pos.addRiceZh")}
                </span>
                <span className={`${s.en} ${s.num}`}>
                  {t("pos.addRiceEn")} {formatCents(riceSideCents)}
                </span>
              </button>
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
        </div>
      </aside>

      {/* ----------------------------------------- the bar (portrait) --
          Always on screen: who it is for, the item count and the running
          total, and Print. A tap opens the ticket sheet. */}
      <div className={s.bar} data-ticket-bar>
        <button
          type="button"
          data-action="open-ticket"
          aria-expanded={ticketOpen}
          aria-label={t("pos.openTicket", { n: itemCount, total: formatCents(total) })}
          onClick={() => setTicketOpen(true)}
          className={s.barMain}
        >
          <Icon name="chevronDown" size={24} className={s.barChevron} />
          <span className={s.barWho}>
            <span className={s.key}>{editing ? t("edit.titleZh", { number: editing.orderNumber }) : t(`channel.${channel}`)}</span>
            <span className={`${s.soft} ${s.one}`}>
              {placed ? `${placed.orderNumber} · ${t("pos.sent")}` : customerSummary || t("pos.addCustomerEn")}
            </span>
          </span>
          <span className={`${s.barTotal} ${s.num}`}>
            <span className={s.v} data-bar-total>
              {formatCents(total)}
            </span>
            <span className={s.n} data-item-count>
              {t("pos.items", { n: itemCount })}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          data-action="bar-print"
          title={!error && lines.length > 0 && missing.length > 0 ? missing.map((k) => t(k)).join(" · ") : undefined}
          className={`${ui.btn} ${canSubmit ? ui.primary : ""} ${s.barPrint}`}
        >
          {editing ? (
            <span lang="zh-Hant" className={s.zh}>
              {dirty ? t("edit.saveZh") : t("edit.noChanges")}
            </span>
          ) : submitting ? (
            t("pos.printing")
          ) : (
            <>
              <span lang="zh-Hant" className={s.zh}>
                {t("pos.printZh")}
              </span>{" "}
              {t("pos.printEn")}
            </>
          )}
        </button>
      </div>

      {confirmEdit && editing && (
        <EditConfirmSheet
          orderNumber={editing.orderNumber}
          preview={confirmEdit.preview}
          web={editing.channel === "web"}
          done={editDone}
          printChange={printChange}
          onPrintChange={setPrintChange}
          saving={submitting}
          error={editError}
          reopen={editConflict}
          onConfirm={() => {
            // Another tablet saved first: load the order as it is now.
            if (editConflict) window.location.reload();
            else void saveEdit();
          }}
          onClose={() => setConfirmEdit(null)}
        />
      )}

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

      {portionItem && (
        <PortionSheet
          item={portionItem}
          sizes={itemSizes(portionItem)}
          highlight={lastPortion}
          onPick={(sizeId) => pickPortion(portionItem, sizeId)}
          onClose={() => setPortionItem(null)}
        />
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
          onAdd={(draft, extraRice) => addLine(draft, sheetItem.replace, extraRice)}
          riceSideCents={riceSide ? riceSideCents : null}
          onClose={() => setSheetItem(null)}
        />
      )}
      {customSheet && (
        <CustomChargeSheet
          initial={customSheet.initial}
          editing={customSheet.replace !== undefined}
          onAdd={(draft) => addCustom(draft, customSheet.replace)}
          onClose={() => setCustomSheet(null)}
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
