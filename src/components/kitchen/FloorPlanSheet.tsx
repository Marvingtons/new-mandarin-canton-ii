"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  FLOOR_TABLES,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  combinationsFor,
  seatsForLabel,
  tableLabel,
  tablesForLabel,
  type FloorTable,
} from "@/lib/kitchen/floor-plan";
import type { OpenTable } from "@/lib/orders/types";
import { useKT } from "@/components/kitchen/KitchenI18n";
import Icon from "@/components/kitchen/Icon";

/**
 * 選桌: the dining room as big tappable shapes, full screen.
 *
 * THE ROOM IS DATA. Every table, its position, size and seat guidance, and
 * which pairs push together, comes from lib/kitchen/floor-plan. Nothing here
 * knows there are nine tables.
 *
 * OCCUPANCY IS THE SERVER'S. Polled from /api/kitchen/tables, which derives it
 * from open dine-in orders. The server also refuses a seating at a taken
 * table, so a stale screen can show the wrong state but cannot act on it.
 *
 * Free and seated must read apart without colour: a seated table is filled
 * brand red AND carries a people icon, the party size and minutes; a free one
 * is a soft white shape with an empty-circle icon and its seat count. Same
 * system as the POS behind it (globals.css, THE POS): warm ground, no lines.
 *
 * Never offers to seat a new party at a seated table. Tapping one offers only
 * 加菜 (another round for the same party) or 清台 (they left), and 清台 asks
 * first.
 */

export interface Seating {
  /** "4" or "4+5". */
  label: string;
  guests: number;
  /** A later round for a party already seated. */
  addon: boolean;
}

type Step =
  | { kind: "room" }
  | { kind: "combine"; table: FloorTable }
  | { kind: "guests"; label: string }
  | { kind: "pad"; label: string; digits: string }
  | { kind: "seated"; open: OpenTable }
  | { kind: "confirmClear"; open: OpenTable };

const POLL_MS = 15_000;
/** Gap between the shape and its table's footprint, in room units. */
const INSET = 6;
/** Smallest tap target a table may render at, in CSS px. */
const MIN_TABLE_PX = 120;
/**
 * The scale below which the smallest table (after its inset) would render
 * under MIN_TABLE_PX. Derived from the room data, so a smaller table added to
 * the floor plan raises it rather than shipping an undersized target.
 */
const MIN_SCALE =
  MIN_TABLE_PX / (Math.min(...FLOOR_TABLES.flatMap((ft) => [ft.w, ft.h])) - 2 * INSET);

function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
}

export default function FloorPlanSheet({
  onSeat,
  onClose,
  onCleared,
}: {
  onSeat: (seating: Seating) => void;
  onClose: () => void;
  /** After a 清台, so the POS can drop a seating that no longer exists. */
  onCleared?: (label: string) => void;
}) {
  const t = useKT();
  const [open, setOpen] = useState<OpenTable[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "room" });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/kitchen/tables", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; tables?: OpenTable[] };
      if (!data.ok || !data.tables) throw new Error("not ok");
      setOpen(data.tables);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoaded(true);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    // Polling an external system and setting state from the answer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(id);
      clearInterval(tick);
    };
  }, [refresh]);

  // Escape backs out one step, then closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (step.kind === "room") onClose();
      else setStep({ kind: "room" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, onClose]);

  /** Which open seating covers each table id. */
  const byTable = useMemo(() => {
    const map = new Map<string, OpenTable>();
    for (const o of open) for (const id of tablesForLabel(o.tableLabel) ?? []) map.set(id, o);
    return map;
  }, [open]);

  /* ------------------------------------------------------- the canvas -- */
  // Room units to CSS px. Never below MIN_SCALE, so no table is ever under a
  // 120px target; the room scrolls instead on a narrow screen.
  const roomRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = roomRef.current;
    if (!el) return;
    const fit = () => {
      // clientWidth/Height include the container's padding; the room does not.
      const style = getComputedStyle(el);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const s = Math.min((el.clientWidth - padX) / ROOM_WIDTH, (el.clientHeight - padY) / ROOM_HEIGHT);
      setScale(Math.max(MIN_SCALE, Number.isFinite(s) ? s : MIN_SCALE));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [step.kind]);

  function tapTable(table: FloorTable) {
    setNotice(null);
    const seated = byTable.get(table.id);
    if (seated) {
      setStep({ kind: "seated", open: seated });
      return;
    }
    if (combinationsFor(table.id).length > 0) setStep({ kind: "combine", table });
    else setStep({ kind: "guests", label: table.id });
  }

  function seat(label: string, guests: number) {
    onSeat({ label, guests, addon: false });
  }

  async function clear(label: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/kitchen/tables", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "clear", label }),
      });
      const data = (await res.json()) as { ok: boolean };
      // A 409 means someone else already cleared it: the outcome staff wanted.
      if (data.ok || res.status === 409) {
        setNotice(t("floor.cleared", { table: label }));
        onCleared?.(label);
      } else {
        setNotice(t("floor.clearFailed"));
      }
    } catch {
      setNotice(t("floor.clearFailed"));
    } finally {
      setBusy(false);
      setStep({ kind: "room" });
      void refresh();
    }
  }

  /* ------------------------------------------------------- the shapes -- */
  // Combined seatings draw as ONE merged shape over both footprints.
  const shapes = useMemo(() => {
    const drawn = new Set<string>();
    const out: { key: string; label: string; tables: FloorTable[]; seated: OpenTable | null }[] = [];
    for (const o of open) {
      const ids = tablesForLabel(o.tableLabel);
      if (!ids || ids.length < 2) continue;
      const tables = ids.map((id) => FLOOR_TABLES.find((ft) => ft.id === id)).filter((x): x is FloorTable => !!x);
      tables.forEach((ft) => drawn.add(ft.id));
      out.push({ key: o.tableLabel, label: o.tableLabel, tables, seated: o });
    }
    for (const ft of FLOOR_TABLES) {
      if (drawn.has(ft.id)) continue;
      const seated = byTable.get(ft.id) ?? null;
      out.push({ key: ft.id, label: ft.id, tables: [ft], seated });
    }
    return out;
  }, [open, byTable]);

  const big = "pos-press flex min-h-[4rem] w-full items-center justify-center gap-3 rounded-pos px-5 text-[1.273rem] font-bold transition-colors";
  const primary = `${big} bg-pos-brand text-white hover:bg-pos-brand-hover`;
  const secondary = `${big} bg-pos-card text-pos-ink shadow-pos-card hover:bg-pos-gold-tint`;
  const tile = "pos-press flex items-center justify-center rounded-pos bg-pos-card font-bold tabular-nums text-pos-ink shadow-pos-card hover:bg-pos-gold-tint";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("floor.title")}
      className="pos-root fixed inset-0 z-[120] flex flex-col bg-pos-bg text-pos-ink"
    >
      {/* ------------------------------------------------------ header -- */}
      <div className="flex h-[var(--pos-top)] shrink-0 items-center gap-4 px-[var(--pos-gap)]">
        {step.kind !== "room" && (
          <button
            type="button"
            onClick={() => setStep({ kind: "room" })}
            className="flex h-[2.545rem] items-center gap-2 rounded-xl px-3 text-base font-semibold hover:bg-pos-sunken"
          >
            <Icon name="chevronLeft" size={24} />
            {t("floor.back")}
          </button>
        )}
        <h2 className="text-[1.455rem] font-bold">{t("floor.title")}</h2>
        <div className="ml-auto flex items-center gap-5">
          <span className="hidden items-center gap-2 text-base md:flex">
            <span className="flex h-[1.636rem] w-[1.636rem] items-center justify-center rounded-lg bg-pos-card text-pos-muted shadow-pos-card">
              <Icon name="circle" size={14} />
            </span>
            {t("floor.free")}
          </span>
          <span className="hidden items-center gap-2 text-base md:flex">
            <span className="flex h-[1.636rem] w-[1.636rem] items-center justify-center rounded-lg bg-pos-brand text-white">
              <Icon name="users" size={14} />
            </span>
            {t("floor.seated")}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-[2.545rem] items-center gap-2 rounded-xl bg-pos-card px-4 text-base font-semibold shadow-pos-card hover:bg-pos-sunken"
          >
            <Icon name="x" size={24} />
            {t("floor.close")}
          </button>
        </div>
      </div>

      {(notice || loadFailed) && (
        <p role="status" className="mx-[var(--pos-gap)] shrink-0 rounded-xl bg-pos-gold-tint px-4 py-2.5 text-base font-semibold">
          {notice ?? t("floor.loadFailed")}
        </p>
      )}

      {/* --------------------------------------------------------- room -- */}
      {step.kind === "room" && (
        <div ref={roomRef} className="min-h-0 flex-1 overflow-auto p-[var(--pos-gap)]" aria-busy={!loaded}>
          <div className="relative mx-auto" style={{ width: ROOM_WIDTH * scale, height: ROOM_HEIGHT * scale }}>
            {shapes.map(({ key, label, tables, seated }) => {
              const x = Math.min(...tables.map((ft) => ft.x));
              const y = Math.min(...tables.map((ft) => ft.y));
              const right = Math.max(...tables.map((ft) => ft.x + ft.w));
              const bottom = Math.max(...tables.map((ft) => ft.y + ft.h));
              const minutes = seated ? minutesSince(seated.seatedAt, now) : 0;
              const seats = seatsForLabel(label);
              return (
                <button
                  key={key}
                  type="button"
                  data-table={label}
                  data-state={seated ? "seated" : "free"}
                  onClick={() => tapTable(tables[0])}
                  aria-label={
                    seated
                      ? t("floor.occupiedTitle", { table: label, n: seated.guestCount ?? 0, min: minutes })
                      : `${t("floor.pick.single", { table: label })}, ${t("floor.free")}`
                  }
                  className={`pos-press absolute flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[20px] text-center transition-colors ${
                    seated
                      ? "bg-pos-brand text-white shadow-pos-card hover:bg-pos-brand-hover"
                      : "bg-pos-card text-pos-ink shadow-pos-card hover:bg-pos-gold-tint"
                  }`}
                  style={{
                    left: (x + INSET) * scale,
                    top: (y + INSET) * scale,
                    width: (right - x - 2 * INSET) * scale,
                    height: (bottom - y - 2 * INSET) * scale,
                  }}
                >
                  {/* 40px+ number. A seated single table carries two more
                      lines in the same 120px, so it steps down to 4xl. */}
                  <span className={`${seated ? "text-4xl" : "text-5xl"} leading-none font-bold tabular-nums`}>{label}</span>
                  {seated ? (
                    <>
                      <span className="flex items-center gap-1 text-lg leading-none font-bold whitespace-nowrap">
                        <Icon name="users" size={18} />
                        {t("board.guests", { n: seated.guestCount ?? 0 })}
                      </span>
                      <span className="flex items-center gap-1 text-base leading-none whitespace-nowrap">
                        <Icon name="clock" size={16} />
                        {t("floor.minutes", { min: minutes })}
                      </span>
                    </>
                  ) : (
                    <span className="flex items-center gap-1.5 text-base leading-tight text-pos-muted">
                      <Icon name="circle" size={14} />
                      {seats != null ? t("floor.seats", { n: seats }) : t("floor.free")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ----------------------------------------- single or combined? -- */}
      {step.kind === "combine" && (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
          {(() => {
            const table = step.table;
            return (
              <>
                <button type="button" className={secondary} onClick={() => setStep({ kind: "guests", label: table.id })}>
                  {t("floor.pick.single", { table: table.id })}
                </button>
                {combinationsFor(table.id).map((combo) => {
                  const label = tableLabel(combo.ids);
                  const busyId = combo.ids.find((id) => byTable.has(id));
                  return (
                    <div key={label} className="flex flex-col gap-2">
                      <button
                        type="button"
                        className={`${secondary} disabled:cursor-not-allowed disabled:bg-pos-sunken disabled:shadow-none`}
                        disabled={!!busyId}
                        onClick={() => setStep({ kind: "guests", label })}
                      >
                        {t("floor.pick.combined", { a: combo.ids[0], b: combo.ids[1] })}
                      </button>
                      {busyId && (
                        <p className="text-base font-semibold text-pos-brand">{t("floor.combinedBusy", { table: busyId })}</p>
                      )}
                    </div>
                  );
                })}
              </>
            );
          })()}
        </div>
      )}

      {/* ---------------------------------------------------- how many? -- */}
      {step.kind === "guests" && (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 overflow-y-auto p-6">
          <h3 className="text-[1.455rem] font-bold">
            {t("floor.pick.single", { table: step.label })} · {t("floor.guestsTitle")}
          </h3>
          {seatsForLabel(step.label) != null && (
            <p className="text-base text-pos-muted">{t("floor.seatsGuide", { n: seatsForLabel(step.label) ?? 0 })}</p>
          )}
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                data-guests={n}
                onClick={() => seat(step.label, n)}
                className={`${tile} min-h-[4.364rem] text-4xl`}
              >
                {n}
              </button>
            ))}
          </div>
          <button type="button" className={secondary} onClick={() => setStep({ kind: "pad", label: step.label, digits: "" })}>
            {t("floor.more")}
          </button>
        </div>
      )}

      {step.kind === "pad" && (
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 overflow-y-auto p-6">
          <h3 className="text-[1.455rem] font-bold">{t("floor.padTitle")}</h3>
          <output aria-live="polite" className="flex min-h-[4.364rem] items-center justify-center rounded-pos bg-pos-card text-6xl font-bold tabular-nums shadow-[inset_0_0_0_3px_var(--color-pos-brand)]">
            {step.digits || "0"}
          </output>
          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setStep({ ...step, digits: (step.digits + d).replace(/^0+/, "").slice(0, 3) })}
                className={`${tile} min-h-[4rem] text-4xl`}
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setStep({ ...step, digits: step.digits.slice(0, -1) })}
              className={`${tile} min-h-[4rem] text-[1.182rem] font-semibold`}
            >
              {t("floor.padDelete")}
            </button>
            <button
              type="button"
              onClick={() => setStep({ ...step, digits: (step.digits + "0").replace(/^0+/, "").slice(0, 3) })}
              className={`${tile} min-h-[4rem] text-4xl`}
            >
              0
            </button>
            <button
              type="button"
              disabled={!step.digits || Number(step.digits) < 1}
              onClick={() => seat(step.label, Number(step.digits))}
              className="flex min-h-[4rem] items-center justify-center rounded-pos bg-pos-brand text-[1.273rem] font-bold text-white hover:bg-pos-brand-hover disabled:cursor-not-allowed disabled:bg-pos-sunken disabled:text-pos-muted"
            >
              {t("floor.padOk")}
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------- a seated table -- */}
      {step.kind === "seated" && (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
          <h3 className="text-[1.455rem] font-bold">
            {t("floor.occupiedTitle", {
              table: step.open.tableLabel,
              n: step.open.guestCount ?? 0,
              min: minutesSince(step.open.seatedAt, now),
            })}
          </h3>
          <p className="text-base text-pos-muted tabular-nums">{step.open.orderNumbers.join(" · ")}</p>
          <button
            type="button"
            className={primary}
            onClick={() =>
              onSeat({ label: step.open.tableLabel, guests: step.open.guestCount ?? 1, addon: true })
            }
          >
            <Icon name="plus" size={28} />
            {t("floor.addItems")}
          </button>
          <button type="button" className={secondary} onClick={() => setStep({ kind: "confirmClear", open: step.open })}>
            {t("floor.clear")}
          </button>
        </div>
      )}

      {step.kind === "confirmClear" && (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
          <p className="text-[1.455rem] font-bold">{t("floor.clearAsk", { table: step.open.tableLabel })}</p>
          <button
            type="button"
            disabled={busy}
            className={`${big} bg-pos-brand text-white hover:bg-pos-brand-hover disabled:opacity-60`}
            onClick={() => void clear(step.open.tableLabel)}
          >
            {busy ? t("common.busy") : t("floor.clearYes", { table: step.open.tableLabel })}
          </button>
          <button type="button" className={secondary} onClick={() => setStep({ kind: "seated", open: step.open })}>
            {t("floor.cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
