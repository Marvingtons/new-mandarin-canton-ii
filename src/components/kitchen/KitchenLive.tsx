"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Station } from "@/config/stations";
import type { Order } from "@/lib/orders/types";
import type { StationPrinterHealth } from "@/lib/print/printerStatus";
import { useKitchenI18n } from "@/components/kitchen/KitchenI18n";
import { useToast } from "@/components/kitchen/ui/Toasts";
import { playChime, resumeOnNextTap, unlockAudio } from "@/components/kitchen/sound";

/**
 * THE STAFF APP'S LIVE DATA: today's orders from both stations, both
 * printers' health, and every action staff can take on an order. One
 * provider in the shell, so the header strip, the board, the POS and history
 * all see the same orders and act through the same code path. A 重印 from the
 * board and a 重印 from history are the same function call.
 *
 * WHY SHORT POLLING AND NOT SUPABASE REALTIME. The database is reached from
 * the Worker through Hyperdrive with the service-role connection; the browser
 * never talks to it. Realtime would mean shipping a Supabase client and key to
 * every tablet and writing RLS policies that expose customer names and phone
 * numbers to it, for a feed that a 4-second poll of a locking read already
 * serves fresh (lockedRead bypasses Hyperdrive's query cache, which is what
 * made the board stale before). Polling also self-heals: a dropped request is
 * fixed by the next one, with no socket to reconnect.
 *
 * OPTIMISTIC ACTIONS. An action changes the order on screen at once, then
 * asks the server. While it is in flight the change is an overlay, so a poll
 * landing mid-request cannot flicker the card back. If the server refuses,
 * the overlay is dropped (the card returns to what the server says) and a
 * toast says why.
 */

const POLL_MS = 4_000;
/** A hidden tab (screen off, another app in front) checks in less often. */
const POLL_HIDDEN_MS = 20_000;
/**
 * The device's sound choice: "on" or "off", absent until staff answer the
 * one-time prompt. (The older mute key is read once, so a tablet already set
 * to silent stays silent and is not asked.)
 */
const SOUND_KEY = "nmc-kitchen-sound";
const LEGACY_MUTE_KEY = "nmc-kitchen-muted";

/** "ask" until this device has answered the Enable sound prompt. */
export type SoundChoice = "ask" | "on" | "off";
/** How long a new order's card stays highlighted. */
const FRESH_MS = 30_000;

export type LiveStatus = "loading" | "live" | "reconnecting" | "unconfigured";

export type OrderAction = "accept" | "complete" | "cancel" | "reprint";

/** All an action needs to know about its order: which, what to call it, which printer. */
export type OrderRef = Pick<Order, "id" | "orderNumber" | "station">;

interface OrdersPayload {
  ok: boolean;
  orders?: Order[];
  printers?: StationPrinterHealth[];
  printersConfigured?: boolean;
  error?: string;
}

/** What the server read for the first paint (KitchenFrame). */
export interface LiveSnapshot {
  orders: Order[];
  printers: StationPrinterHealth[];
  printersConfigured: boolean;
}

interface LiveValue {
  orders: Order[];
  printers: StationPrinterHealth[];
  printersConfigured: boolean;
  status: LiveStatus;
  lastSync: Date | null;
  /** Orders that arrived since this screen opened, still highlighted. */
  freshIds: ReadonlySet<number>;
  /** Ids with an action in flight. */
  pendingIds: ReadonlySet<number>;
  /** True unless sound is on. A device that has not chosen yet is silent. */
  muted: boolean;
  /** Where this device is: "ask" shows the one-time prompt. */
  sound: SoundChoice;
  /** Call from a tap: turning sound on unlocks audio inside the gesture. */
  toggleMute: () => void;
  /** The prompt's two answers. enableSound must run inside the tap. */
  enableSound: () => void;
  declineSound: () => void;
  refresh: () => Promise<void>;
  act: (order: OrderRef, action: OrderAction, extra?: { note?: string; station?: Station }) => Promise<boolean>;
  clearTable: (tableLabel: string) => Promise<boolean>;
}

const LiveContext = createContext<LiveValue | null>(null);

/** What an action looks like on screen before the server answers. */
function optimisticPatch(action: OrderAction): Partial<Order> {
  switch (action) {
    case "accept":
      return { status: "ACCEPTED" };
    case "complete":
      return { status: "COMPLETED" };
    case "cancel":
      return { status: "CANCELLED", printStuck: false };
    case "reprint":
      // A reprint asks for a copy; it never moves the order. Status and
      // station stay as they are, so the card does not jump lanes.
      return { reprintPending: true, printStuck: false, lastPrintError: null };
  }
}

export function KitchenLiveProvider({
  ordersConfigured,
  initial,
  children,
}: {
  ordersConfigured: boolean;
  initial: LiveSnapshot | null;
  children: React.ReactNode;
}) {
  const { t } = useKitchenI18n();
  const { toast } = useToast();

  const [serverOrders, setServerOrders] = useState<Order[]>(() => initial?.orders ?? []);
  const [printers, setPrinters] = useState<StationPrinterHealth[]>(() => initial?.printers ?? []);
  const [printersConfigured, setPrintersConfigured] = useState(() => initial?.printersConfigured ?? true);
  const [status, setLiveStatus] = useState<LiveStatus>(
    !ordersConfigured ? "unconfigured" : initial ? "live" : "loading",
  );
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [freshIds, setFreshIds] = useState<ReadonlySet<number>>(new Set());
  const [sound, setSound] = useState<SoundChoice>("ask");
  const muted = sound !== "on";
  /** orderId -> the patch on screen while its request is in flight. */
  const [overlays, setOverlays] = useState<ReadonlyMap<number, { token: number; patch: Partial<Order> }>>(
    new Map(),
  );
  const tokenRef = useRef(0);
  // Seeded from the server's read, so opening the board mid-service does not
  // announce every order already on it.
  const seenRef = useRef<Set<number> | null>(initial ? new Set(initial.orders.map((o) => o.id)) : null);
  const chime = useCallback(() => {
    if (!muted) playChime();
  }, [muted]);

  // Sound is per device, read after mount so the server render matches.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SOUND_KEY);
      const legacyMuted = localStorage.getItem(LEGACY_MUTE_KEY) === "1";
      const choice: SoundChoice =
        stored === "on" || stored === "off" ? stored : legacyMuted ? "off" : "ask";
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading a device preference once
      setSound(choice);
    } catch {
      /* storage blocked: ask every visit */
    }
  }, []);

  // A context the iPad suspended (sleep, background, another app's audio)
  // comes back on the next tap anywhere, not only on the bell.
  useEffect(() => resumeOnNextTap(), []);

  const choose = useCallback((next: "on" | "off") => {
    // Inside the caller's gesture, before anything awaits: this is the tap
    // WebKit needs to see.
    if (next === "on") void unlockAudio();
    setSound(next);
    try {
      localStorage.setItem(SOUND_KEY, next);
      localStorage.removeItem(LEGACY_MUTE_KEY);
    } catch {
      /* still applies for this visit */
    }
  }, []);

  const toggleMute = useCallback(() => choose(muted ? "on" : "off"), [choose, muted]);
  const enableSound = useCallback(() => {
    choose("on");
    // Play it once, so staff hear what an online order sounds like and know
    // this tablet is not muted at the hardware.
    playChime();
  }, [choose]);
  const declineSound = useCallback(() => choose("off"), [choose]);

  /* The highlight timers, so leaving the staff app cancels them. */
  const freshTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = freshTimers.current;
    return () => {
      for (const id of timers) clearTimeout(id);
      timers.clear();
    };
  }, []);

  const announce = useCallback(
    (arrivals: Order[]) => {
      const ids = new Set(arrivals.map((o) => o.id));
      setFreshIds((prev) => new Set([...prev, ...ids]));
      const timer = setTimeout(() => {
        freshTimers.current.delete(timer);
        setFreshIds((prev) => new Set([...prev].filter((id) => !ids.has(id))));
      }, FRESH_MS);
      freshTimers.current.add(timer);
      // Sound and a toast for ONLINE orders only: nobody entered them at this
      // counter, so nobody here knows they exist. A store order was typed in
      // by the person standing here; it is highlighted, not announced.
      const online = arrivals.filter((o) => o.station === "online");
      if (online.length > 0) {
        chime();
        for (const o of online) toast(t("board.newOnline", { number: o.orderNumber }), "arrival");
      }
    },
    [chime, toast, t],
  );

  const refresh = useCallback(async () => {
    if (!ordersConfigured) return;
    try {
      const res = await fetch("/api/kitchen/orders?completed=1", { cache: "no-store" });
      if (res.status === 401) {
        // Session expired mid-shift: a reload lands on the sign-in screen.
        window.location.reload();
        return;
      }
      const data = (await res.json()) as OrdersPayload;
      if (!data.ok) {
        setLiveStatus("reconnecting");
        return;
      }
      const next = data.orders ?? [];
      const seen = seenRef.current;
      if (seen === null) {
        // First load: adopt everything without announcing it.
        seenRef.current = new Set(next.map((o) => o.id));
      } else {
        const arrivals = next.filter((o) => !seen.has(o.id));
        for (const o of arrivals) seen.add(o.id);
        if (arrivals.length > 0) announce(arrivals);
      }
      setServerOrders(next);
      setPrinters(data.printers ?? []);
      setPrintersConfigured(data.printersConfigured !== false);
      setLiveStatus("live");
      setLastSync(new Date());
    } catch {
      setLiveStatus("reconnecting");
    }
  }, [ordersConfigured, announce]);

  // The poll loop reads the latest refresh through a ref, so a new chime
  // (sound toggled) does not tear the loop down and poll twice.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!ordersConfigured) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    // One request at a time: a tab coming back while a poll is in flight
    // must not start a second chain of timers.
    let inFlight = false;
    const tick = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        await refreshRef.current();
      } finally {
        inFlight = false;
      }
      if (stopped) return;
      clearTimeout(timer);
      timer = setTimeout(tick, document.hidden ? POLL_HIDDEN_MS : POLL_MS);
    };
    // Coming back to the tab is the moment staff look: fetch now, not in 20s.
    const onVisible = () => {
      if (document.hidden) return;
      clearTimeout(timer);
      void tick();
    };
    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ordersConfigured]);

  const setOverlay = useCallback((ids: number[], patch: Partial<Order>): number => {
    const token = ++tokenRef.current;
    setOverlays((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.set(id, { token, patch });
      return next;
    });
    return token;
  }, []);

  const dropOverlay = useCallback((ids: number[], token: number) => {
    setOverlays((prev) => {
      const next = new Map(prev);
      for (const id of ids) if (next.get(id)?.token === token) next.delete(id);
      return next;
    });
  }, []);

  /** Fold the server's answer for one order in, keeping the board-only aggregates. */
  const adopt = useCallback((updated: Order) => {
    setServerOrders((list) =>
      list.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)),
    );
  }, []);

  const act = useCallback<LiveValue["act"]>(
    async (order, action, extra) => {
      const token = setOverlay([order.id], optimisticPatch(action));
      const failed = (reason?: string) => {
        dropOverlay([order.id], token);
        toast(
          reason
            ? t("toast.failedReason", { number: order.orderNumber, reason })
            : t("toast.failed", { number: order.orderNumber }),
          "error",
        );
        return false;
      };
      let data: { ok: boolean; code?: string; error?: string; order?: Order | null };
      try {
        const res = await fetch(`/api/kitchen/orders/${order.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action,
            ...(extra?.note ? { note: extra.note } : {}),
            ...(extra?.station ? { station: extra.station } : {}),
          }),
        });
        if (res.status === 401) {
          window.location.reload();
          return false;
        }
        // Every refusal from this route is JSON with ok:false; anything else
        // (a proxy error page, a 502) is a refusal too.
        data = res.headers.get("content-type")?.includes("json")
          ? await res.json()
          : { ok: false };
      } catch {
        dropOverlay([order.id], token);
        toast(t("toast.offline"), "error");
        return false;
      }
      if (!data.ok) {
        return failed(
          data.code === "cancelled"
            ? t("board.cancelledNoReprint")
            : data.code === "printing"
              ? t("board.printingNoReprint")
              : undefined,
        );
      }
      if (data.order) adopt(data.order);
      dropOverlay([order.id], token);
      // A reprint's printer is the one picked; the order itself never moves.
      const station =
        (action === "reprint" ? extra?.station : undefined) ?? data.order?.station ?? order.station;
      const stationName = t(`station.${station}`);
      toast(
        action === "accept"
          ? t("toast.accepted", { number: order.orderNumber })
          : action === "complete"
            ? t("toast.completed", { number: order.orderNumber })
            : action === "cancel"
              ? t("toast.cancelled", { number: order.orderNumber })
              : t("toast.reprinted", { number: order.orderNumber, station: stationName }),
      );
      return true;
    },
    [setOverlay, dropOverlay, adopt, toast, t],
  );

  const clearTable = useCallback<LiveValue["clearTable"]>(
    async (tableLabel) => {
      const ids: number[] = [];
      for (const o of serverOrders) {
        if (o.channel === "dine_in" && o.tableLabel === tableLabel && o.tableClearedAt === null) ids.push(o.id);
      }
      // What the server does (repository clearTable): stamp the table cleared
      // and close what was printed or cooking. Shown now, confirmed below.
      const token = setOverlay(ids, { tableClearedAt: new Date().toISOString() });
      try {
        const res = await fetch("/api/kitchen/tables", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "clear", label: tableLabel }),
        });
        // 409 is "that table is not seated": someone else already cleared it,
        // which is the outcome staff wanted.
        const cleared = res.status === 409 || (res.ok && ((await res.json()) as { ok: boolean }).ok);
        if (!cleared) {
          dropOverlay(ids, token);
          toast(t("toast.failedReason", { number: t("board.table", { table: tableLabel }), reason: t("board.actionFailed") }), "error");
          return false;
        }
      } catch {
        dropOverlay(ids, token);
        toast(t("toast.offline"), "error");
        return false;
      }
      await refresh();
      dropOverlay(ids, token);
      toast(t("toast.tableCleared", { table: tableLabel }));
      return true;
    },
    [serverOrders, setOverlay, dropOverlay, refresh, toast, t],
  );

  const orders = useMemo(
    () =>
      overlays.size === 0
        ? serverOrders
        : serverOrders.map((o) => {
            const overlay = overlays.get(o.id);
            return overlay ? { ...o, ...overlay.patch } : o;
          }),
    [serverOrders, overlays],
  );
  const pendingIds = useMemo(() => new Set(overlays.keys()), [overlays]);

  const value = useMemo<LiveValue>(
    () => ({
      orders,
      printers,
      printersConfigured,
      status,
      lastSync,
      freshIds,
      pendingIds,
      muted,
      sound,
      toggleMute,
      enableSound,
      declineSound,
      refresh,
      act,
      clearTable,
    }),
    [
      orders, printers, printersConfigured, status, lastSync, freshIds, pendingIds,
      muted, sound, toggleMute, enableSound, declineSound, refresh, act, clearTable,
    ],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useKitchenLive(): LiveValue {
  const value = useContext(LiveContext);
  if (!value) throw new Error("useKitchenLive outside KitchenLiveProvider");
  return value;
}
