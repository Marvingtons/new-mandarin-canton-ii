"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  FLOOR_LANDMARKS,
  FLOOR_TABLES,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TABLE_COMBINATIONS,
  floorTable,
  tableLabel,
  tablesForLabel,
  type FloorTable,
} from "@/lib/kitchen/floor-plan";
import type { OpenTable } from "@/lib/orders/types";
import { formatCents } from "@/lib/money";
import { useKT } from "@/components/kitchen/KitchenI18n";
import Icon, { posIcon } from "@/components/kitchen/Icon";
import s from "@/components/kitchen/pos.module.css";

/**
 * 堂食's home: the open tables on the left, the room on the right
 * (docs/kitchen-design.md, floor plan). Rendered inside the POS grid, under
 * the same top bar, not as a sheet over it.
 *
 * THE ROOM IS DATA. Tables, chairs, the pairs that push together and the
 * landmarks all come from lib/kitchen/floor-plan; nothing here knows there
 * are nine tables.
 *
 * OCCUPANCY IS THE SERVER'S. Polled from /api/kitchen/tables, which derives it
 * from open dine-in orders, and the server refuses a seating at a taken
 * table, so a stale screen can show the wrong state but cannot act on it.
 *
 * Free is white, seated is the brand red with its minutes, past an hour the
 * minutes turn amber. A seated table never offers a new party: tapping it
 * opens its details, with 加菜 or 清台, and 清台 asks first.
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
  | { kind: "guests"; label: string }
  | { kind: "pad"; label: string; digits: string }
  | { kind: "seated"; open: OpenTable }
  | { kind: "confirmClear"; open: OpenTable };

const POLL_MS = 15_000;
/** Seated longer than this, the minutes turn amber. */
const LONG_MINUTES = 60;
/** Room units of margin around the walls, so landmarks outside them still draw. */
const PAD = 48;
const CHAIR = 26;
const CHAIR_GAP = 8;

function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
}

export default function FloorPlan({
  onSeat,
  onCleared,
  onBack,
  placed,
}: {
  /** The order just printed (A-012 · sent), shown here because 堂食 returns to the room. */
  placed: React.ReactNode;
  onSeat: (seating: Seating) => void;
  /** After a 清台, so the POS can drop a seating that no longer exists. */
  onCleared?: (label: string) => void;
  /** Back to the ticket without changing table; null when there is no table yet. */
  onBack: (() => void) | null;
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

  /** Which open seating covers each table id. */
  const byTable = useMemo(() => {
    const map = new Map<string, OpenTable>();
    for (const o of open) for (const id of tablesForLabel(o.tableLabel) ?? []) map.set(id, o);
    return map;
  }, [open]);

  const longestFirst = useMemo(() => [...open].sort((a, b) => Date.parse(a.seatedAt) - Date.parse(b.seatedAt)), [open]);

  /* ------------------------------------------------------- the canvas -- */
  // Room units to CSS px: the walls plus their margin, scaled to fill the
  // pane and centred.
  const paneRef = useRef<HTMLElement>(null);
  const [box, setBox] = useState({ scale: 0, left: 0, top: 0 });
  useLayoutEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const fit = () => {
      const style = getComputedStyle(el);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const scale = Math.max(
        0,
        Math.min((el.clientWidth - padX) / (ROOM_WIDTH + PAD * 2), (el.clientHeight - padY) / (ROOM_HEIGHT + PAD * 2)),
      );
      setBox({
        scale,
        left: (el.clientWidth - (ROOM_WIDTH + PAD * 2) * scale) / 2,
        top: (el.clientHeight - (ROOM_HEIGHT + PAD * 2) * scale) / 2,
      });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const k = box.scale;
  const X = (u: number) => (u + PAD) * k;
  const rect = (x: number, y: number, w: number, h: number): React.CSSProperties => ({
    left: X(x),
    top: X(y),
    width: w * k,
    height: h * k,
  });
  const radius = 14 * k;

  /* ------------------------------------------------------------ actions -- */
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sheetOpen = step.kind === "guests" || step.kind === "pad";
  useEffect(() => {
    if (sheetOpen && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [sheetOpen]);

  function closeSheet() {
    dialogRef.current?.close();
  }

  function tapFree(label: string) {
    setNotice(null);
    setStep({ kind: "guests", label });
  }

  function tapSeated(o: OpenTable) {
    setNotice(null);
    setStep({ kind: "seated", open: o });
  }

  function seat(label: string, guests: number) {
    closeSheet();
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

  const selected =
    step.kind === "guests" || step.kind === "pad"
      ? step.label
      : step.kind === "seated" || step.kind === "confirmClear"
        ? step.open.tableLabel
        : null;

  /* ------------------------------------------------------- the shapes -- */
  const minutesPill = (o: OpenTable) => {
    const min = minutesSince(o.seatedAt, now);
    return min > LONG_MINUTES ? (
      <span className={`${s.pill} ${s.amber}`}>{t("floor.minShort", { min })}</span>
    ) : (
      <span>{t("floor.minShort", { min })}</span>
    );
  };

  const tableButton = (
    key: string,
    label: string,
    style: React.CSSProperties,
    seatedAt: OpenTable | null,
  ) => (
    <button
      key={key}
      type="button"
      data-table={label}
      data-state={seatedAt ? "seated" : "free"}
      onClick={() => (seatedAt ? tapSeated(seatedAt) : tapFree(label))}
      aria-label={
        seatedAt
          ? t("floor.occupiedTitle", { table: label, n: seatedAt.guestCount ?? 0, min: minutesSince(seatedAt.seatedAt, now) })
          : `${t("floor.tableTitle", { table: label })}, ${t("floor.free")}`
      }
      className={[s.tbl, seatedAt && s.seated, selected === label && s.selected].filter(Boolean).join(" ")}
      style={style}
    >
      <span className={`${s.n} ${s.num}`}>{label}</span>
      {seatedAt && <span className={`${s.stt} ${s.num}`}>{minutesPill(seatedAt)}</span>}
    </button>
  );

  const paired = new Set(TABLE_COMBINATIONS.flatMap((c) => c.ids));
  const shapes: React.ReactNode[] = [];
  for (const ft of FLOOR_TABLES) {
    if (paired.has(ft.id)) continue;
    shapes.push(tableButton(ft.id, ft.id, { ...rect(ft.x, ft.y, ft.w, ft.h), borderRadius: radius }, byTable.get(ft.id) ?? null));
  }
  for (const combo of TABLE_COMBINATIONS) {
    const [a, b] = combo.ids.map((id) => floorTable(id)) as [FloorTable, FloorTable];
    const label = tableLabel(combo.ids);
    const joined = open.find((o) => o.tableLabel === label) ?? null;
    if (joined) {
      // Seated together: one long table, one shape.
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.max(a.x + a.w, b.x + b.w) - x;
      const h = Math.max(a.y + a.h, b.y + b.h) - y;
      shapes.push(tableButton(label, label, { ...rect(x, y, w, h), borderRadius: radius }, joined));
      continue;
    }
    // Two halves of one long table: rounded only on their outer ends.
    const vertical = b.y > a.y;
    shapes.push(
      tableButton(a.id, a.id, { ...rect(a.x, a.y, a.w, a.h), borderRadius: vertical ? `${radius}px ${radius}px 0 0` : `${radius}px 0 0 ${radius}px` }, byTable.get(a.id) ?? null),
      tableButton(b.id, b.id, { ...rect(b.x, b.y, b.w, b.h), borderRadius: vertical ? `0 0 ${radius}px ${radius}px` : `0 ${radius}px ${radius}px 0` }, byTable.get(b.id) ?? null),
    );
    shapes.push(
      <div
        key={`${label}-split`}
        aria-hidden="true"
        className={s.split}
        style={vertical ? { left: X(a.x), top: X(b.y) - 1, width: a.w * k } : { left: X(b.x) - 1, top: X(a.y), height: a.h * k, borderTop: 0, borderLeft: "2px dashed var(--text-faint)" }}
      />,
    );
    if (!byTable.has(a.id) && !byTable.has(b.id)) {
      shapes.push(
        <button
          key={`${label}-combine`}
          type="button"
          data-combine={label}
          onClick={() => tapFree(label)}
          aria-label={t("floor.pick.combined", { a: combo.ids[0], b: combo.ids[1] })}
          className={`${s.btn} ${s.secondary} ${s.combine}`}
          style={vertical ? { left: X(a.x + a.w / 2), top: X(b.y) } : { left: X(b.x), top: X(a.y + a.h / 2) }}
        >
          {t("floor.combine")}
        </button>,
      );
    }
  }

  const chairs: React.ReactNode[] = [];
  for (const ft of FLOOR_TABLES) {
    for (const [side, n] of Object.entries(ft.chairs) as ["t" | "r" | "b" | "l", number][]) {
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n;
        const cx =
          side === "l" ? ft.x - CHAIR_GAP - CHAIR / 2 : side === "r" ? ft.x + ft.w + CHAIR_GAP + CHAIR / 2 : ft.x + f * ft.w;
        const cy =
          side === "t" ? ft.y - CHAIR_GAP - CHAIR / 2 : side === "b" ? ft.y + ft.h + CHAIR_GAP + CHAIR / 2 : ft.y + f * ft.h;
        chairs.push(<div key={`${ft.id}${side}${i}`} className={s.chair} style={rect(cx - CHAIR / 2, cy - CHAIR / 2, CHAIR, CHAIR)} />);
      }
    }
  }

  const landmarks = FLOOR_LANDMARKS.flatMap((m) =>
    m.kind === "door"
      ? [
          <div key={`${m.id}-gap`} className={s.door} style={{ left: X(m.x), top: (ROOM_HEIGHT + PAD * 2) * k - 3, width: m.w * k, height: 4 }} />,
          <div key={m.id} className={s.mark} style={rect(m.x, m.y - 40, m.w, 36)}>
            {m.nameZh} {m.nameEn}
          </div>,
        ]
      : [
          <div key={m.id} className={`${s.mark} ${s.box}`} style={rect(m.x, m.y, m.w, m.h)}>
            {m.nameZh}
            <br />
            {m.nameEn}
          </div>,
        ],
  );

  /* ---------------------------------------------------------- the pane -- */
  const details = step.kind === "seated" || step.kind === "confirmClear" ? step.open : null;

  const statusLine = (
    <>
      {placed}
      {(notice || loadFailed) && (
        <p role="status" className={s.notice}>
          {notice ?? t("floor.loadFailed")}
        </p>
      )}
    </>
  );

  return (
    <>
      <aside aria-label={t("floor.openEn")} className={`${s.list} ${details ? s.details : ""}`}>
        {details ? (
          <>
            <div className={s.detMain}>
              <button type="button" onClick={() => setStep({ kind: "room" })} className={`${s.btn} ${s.quiet}`}>
                <Icon name="chevronLeft" size={posIcon(24)} />
                {t("floor.allTables")}
              </button>
              <div className={s.detH}>
                <div className={`${s.tn} ${s.num}`}>{t("floor.tableTitle", { table: details.tableLabel })}</div>
                <div className={`${s.meta} ${s.num}`}>{t("floor.minutes", { min: minutesSince(details.seatedAt, now) })}</div>
              </div>
              <div className={`${s.detOrders} ${s.num}`}>
                {details.orderNumbers.map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </div>
            </div>
            <div className={s.listFoot}>
              {statusLine}
              {step.kind === "confirmClear" ? (
                <>
                  <p className={s.ask}>{t("floor.clearAsk", { table: details.tableLabel })}</p>
                  <button type="button" disabled={busy} onClick={() => void clear(details.tableLabel)} className={`${s.btn} ${s.primary}`}>
                    {busy ? t("common.busy") : t("floor.clearYes", { table: details.tableLabel })}
                  </button>
                  <button type="button" onClick={() => setStep({ kind: "seated", open: details })} className={`${s.btn} ${s.secondary}`}>
                    {t("floor.cancel")}
                  </button>
                </>
              ) : (
                <>
                  <div className={s.detTotal}>
                    <span>{t("pos.totalLabel")}</span>
                    <span className={`${s.v} ${s.num}`}>{formatCents(details.totalCents)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSeat({ label: details.tableLabel, guests: details.guestCount ?? 1, addon: true })}
                    className={`${s.btn} ${s.primary}`}
                  >
                    {t("floor.addItems")}
                  </button>
                  <button type="button" onClick={() => setStep({ kind: "confirmClear", open: details })} className={`${s.btn} ${s.secondary}`}>
                    {t("floor.clear")}
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className={s.listH}>
              <span className={s.zh}>{t("floor.openZh")}</span>
              <span className={s.en}>{t("floor.openEn")}</span>
              <span className={`${s.c} ${s.num}`}>{open.length}</span>
            </div>
            {longestFirst.map((o) => (
              <button key={o.tableLabel} type="button" onClick={() => tapSeated(o)} className={s.open}>
                <span className={`${s.tn} ${s.num}`}>{o.tableLabel}</span>
                <span className={`${s.m} ${s.num}`}>
                  {minutesSince(o.seatedAt, now) > LONG_MINUTES ? (
                    <span className={`${s.pill} ${s.amber}`}>{t("floor.minutes", { min: minutesSince(o.seatedAt, now) })}</span>
                  ) : (
                    t("floor.minutes", { min: minutesSince(o.seatedAt, now) })
                  )}
                </span>
              </button>
            ))}
            <div className={s.listFoot}>
              {statusLine}
              {onBack && (
                <button type="button" onClick={onBack} className={`${s.btn} ${s.secondary}`}>
                  {t("floor.backToTicket")}
                </button>
              )}
            </div>
          </>
        )}
      </aside>

      <main ref={paneRef} className={s.roomPane} aria-busy={!loaded} aria-label={t("floor.title")}>
        {k > 0 && (
          <div className={s.room} style={{ left: box.left, top: box.top, width: (ROOM_WIDTH + PAD * 2) * k, height: (ROOM_HEIGHT + PAD * 2) * k }}>
            <div className={s.walls} />
            {landmarks}
            {chairs}
            {shapes}
          </div>
        )}
      </main>

      {sheetOpen && (
        <dialog
          ref={dialogRef}
          aria-label={t("floor.guestsEn")}
          onClose={() => setStep((st) => (st.kind === "guests" || st.kind === "pad" ? { kind: "room" } : st))}
          className={s.dialog}
        >
          {/* The scrim is a button inside the dialog, so the dialog itself
              carries no click handler; Escape closes it natively. */}
          <button type="button" aria-hidden="true" tabIndex={-1} className={s.scrim} onClick={closeSheet} />
          <div className={s.sheet}>
            <div className={s.sheetH}>
              <span className={s.zh}>{t("floor.guestsZh", { table: step.label })}</span>
              <span className={s.en}>{t("floor.guestsEn")}</span>
            </div>
            {step.kind === "guests" ? (
              <div className={`${s.keys} ${s.num}`}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" data-guests={n} onClick={() => seat(step.label, n)} className={`${s.btn} ${s.secondary}`}>
                    {n}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setStep({ kind: "pad", label: step.label, digits: "" })}
                  className={`${s.btn} ${s.secondary} ${s.wide}`}
                >
                  {t("floor.moreKey")}
                </button>
              </div>
            ) : (
              <>
                <output aria-live="polite" className={`${s.padOut} ${s.num}`}>
                  {step.digits || "0"}
                </output>
                <div className={`${s.keys} ${s.pad} ${s.num}`}>
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setStep({ ...step, digits: (step.digits + d).replace(/^0+/, "").slice(0, 3) })}
                      className={`${s.btn} ${s.secondary}`}
                    >
                      {d}
                    </button>
                  ))}
                  <button type="button" onClick={() => setStep({ ...step, digits: step.digits.slice(0, -1) })} className={`${s.btn} ${s.secondary} ${s.word}`}>
                    {t("floor.padDelete")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep({ ...step, digits: (step.digits + "0").replace(/^0+/, "").slice(0, 3) })}
                    className={`${s.btn} ${s.secondary}`}
                  >
                    0
                  </button>
                  <button
                    type="button"
                    disabled={!step.digits || Number(step.digits) < 1}
                    onClick={() => seat(step.label, Number(step.digits))}
                    className={`${s.btn} ${s.primary} ${s.word}`}
                  >
                    {t("floor.padOk")}
                  </button>
                </div>
              </>
            )}
            <div className={s.sheetFoot}>
              <button type="button" onClick={closeSheet} className={`${s.btn} ${s.quiet}`}>
                {t("floor.cancel")}
              </button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
