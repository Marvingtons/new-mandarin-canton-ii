"use client";

import { useCallback, useEffect, useState } from "react";
import { useKT } from "@/components/kitchen/KitchenI18n";
import Icon from "@/components/kitchen/Icon";
import type { KitchenKey } from "@/lib/kitchen/i18n";
import type { OrderChannel, PrinterRole } from "@/lib/orders/types";
import type { PrinterHealth } from "@/lib/print/printerStatus";

/**
 * /{kitchen}/printers: what each printer is, how it is, where each kind of
 * order prints, and how many copies.
 *
 * Seeing is open to the kitchen session. Every change carries the owner PIN
 * typed into the field at the top; the server checks it on every request, so
 * nothing here is trusted to decide who may change what.
 */

interface PrinterRow {
  id: string;
  label: string;
  name: string | null;
  mac: string;
  role: PrinterRole | null;
  active: boolean;
  health: PrinterHealth;
  down: boolean;
  secondsSinceSeen: number | null;
  statusCode: string | null;
}

interface RouteRow {
  channel: OrderChannel;
  role: PrinterRole;
  copyRoles: string[] | null;
}

interface AuditRow {
  id: number;
  at: string;
  action: string;
  target: string | null;
  oldValue: unknown;
  newValue: unknown;
}

interface Payload {
  ok: boolean;
  pinConfigured: boolean;
  defaultCopyRoles: string[];
  printers: PrinterRow[];
  routes: RouteRow[];
  audit: AuditRow[];
}

type Change =
  | { action: "assign"; printerId: string; role: PrinterRole; name?: string }
  | { action: "rename"; printerId: string; name: string }
  | { action: "deactivate"; printerId: string }
  | { action: "route"; channel: OrderChannel; role: PrinterRole }
  | { action: "copies"; channel: OrderChannel; copyRoles: string[] | null };

const STATE_KEY: Record<PrinterHealth, KitchenKey> = {
  ok: "printer.state.ok",
  "paper-out": "printer.state.paperOut",
  "cover-open": "printer.state.coverOpen",
  offline: "printer.state.offline",
  unknown: "printer.state.unknown",
};

const ROLE_KEY: Record<PrinterRole, KitchenKey> = {
  takeout: "printers.role.takeout",
  pos: "printers.role.pos",
};

const CHANNEL_KEY: Record<OrderChannel, KitchenKey> = {
  web: "channel.web",
  phone: "channel.phone",
  walk_in: "channel.walk_in",
  dine_in: "channel.dine_in",
};

/** Copy presets offered in the dropdown. "default" = the environment's set. */
const COPY_PRESETS: Array<{ id: string; roles: string[] | null; label: KitchenKey }> = [
  { id: "default", roles: null, label: "printers.copies.default" },
  { id: "kitchen1", roles: ["kitchen"], label: "printers.copies.kitchen1" },
  { id: "all1", roles: ["all"], label: "printers.copies.all1" },
  { id: "kitchenBag", roles: ["kitchen", "bag"], label: "printers.copies.kitchenBag" },
  { id: "kitchenBagRegister", roles: ["kitchen", "bag", "register"], label: "printers.copies.kitchenBagRegister" },
];

function presetFor(roles: string[] | null): string {
  const key = roles === null ? null : roles.join(",");
  return COPY_PRESETS.find((p) => (p.roles === null ? null : p.roles.join(",")) === key)?.id ?? "custom";
}

const card = "rounded-lg border border-staff-line bg-staff-panel p-5";
const button =
  "flex min-h-12 items-center gap-2 rounded-md border border-staff-line-strong bg-staff-panel px-4 text-base font-semibold text-staff-ink transition-colors hover:bg-staff-sunken disabled:opacity-50";
const select =
  "min-h-12 rounded-md border border-staff-line-strong bg-staff-panel px-3 text-base text-staff-ink";

export default function PrinterAdmin() {
  const t = useKT();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/kitchen/printers", { cache: "no-store" });
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      const body = (await res.json()) as Payload;
      if (!body.ok) {
        setError(t("printers.loadError"));
        return;
      }
      setData(body);
      setError(null);
    } catch {
      setError(t("printers.loadError"));
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const id = setInterval(() => void load(), 10_000);
    return () => clearInterval(id);
  }, [load]);

  const change = useCallback(
    async (c: Change) => {
      if (!pin.trim()) {
        setNotice(t("printers.pinMissing"));
        return;
      }
      setBusy(true);
      setNotice(null);
      try {
        const res = await fetch("/api/kitchen/printers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pin, change: c }),
        });
        const body = (await res.json()) as { ok: boolean; code?: string; error?: string };
        if (body.ok) setNotice(t("printers.saved"));
        else if (body.code === "pin_wrong") setNotice(t("printers.pinWrong"));
        else if (body.code === "pin_locked" || res.status === 429) setNotice(t("printers.pinLocked"));
        else if (body.code === "pin_not_configured") setNotice(t("printers.pinNotConfigured"));
        else if (body.code === "invalid" && body.error) setNotice(body.error);
        else setNotice(t("printers.error"));
      } catch {
        setNotice(t("printers.error"));
      } finally {
        setBusy(false);
      }
      await load();
    },
    [pin, load, t],
  );

  const seen = (s: number | null) =>
    s === null
      ? t("printers.neverSeen")
      : t("printer.lastSeen", {
          ago: s < 90 ? t("printer.secondsAgo", { n: s }) : t("printer.minutesAgo", { n: Math.round(s / 60) }),
        });

  const assigned = data?.printers.filter((p) => p.role !== null) ?? [];
  const unassigned = data?.printers.filter((p) => p.role === null) ?? [];

  const printerCard = (p: PrinterRow) => (
    <li key={p.id} className={card} data-printer={p.mac} data-role={p.role ?? "none"} data-active={p.active}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-center gap-2 text-lg font-semibold">
          <Icon name="printer" size={20} />
          {p.label}
        </span>
        <span className="text-base text-staff-soft">
          {p.role ? t(ROLE_KEY[p.role]) : t("printers.role.none")}
          {" · "}
          {p.active ? t("printers.active") : t("printers.inactive")}
        </span>
      </div>
      <p className={`mt-1 text-base ${p.health === "ok" ? "text-staff-soft" : "font-semibold text-staff-danger"}`}>
        {t(STATE_KEY[p.health])} · {seen(p.secondsSinceSeen)}
        {p.statusCode ? ` · ${t("printer.reported", { code: p.statusCode })}` : ""}
      </p>
      <p className="mt-1 text-sm text-staff-faint">{t("printers.mac", { mac: p.mac })}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(["takeout", "pos"] as const).map((role) =>
          p.active && p.role === role ? null : (
            <button
              key={role}
              type="button"
              disabled={busy}
              data-assign={role}
              className={button}
              onClick={() =>
                void change({ action: "assign", printerId: p.id, role, name: names[p.id]?.trim() || undefined })
              }
            >
              {role === "takeout" ? t("printers.assignTakeout") : t("printers.assignPos")}
            </button>
          ),
        )}
        <input
          value={names[p.id] ?? ""}
          onChange={(e) => setNames((n) => ({ ...n, [p.id]: e.target.value }))}
          placeholder={t("printers.namePlaceholder")}
          aria-label={t("printers.rename")}
          maxLength={60}
          className="min-h-12 rounded-md border border-staff-line-strong bg-staff-panel px-3 text-base"
        />
        <button
          type="button"
          disabled={busy || !(names[p.id] ?? "").trim()}
          className={button}
          onClick={() => void change({ action: "rename", printerId: p.id, name: names[p.id] ?? "" })}
        >
          {t("printers.rename")}
        </button>
        {p.active && (
          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={() => void change({ action: "deactivate", printerId: p.id })}
          >
            {t("printers.deactivate")}
          </button>
        )}
      </div>
    </li>
  );

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 pt-5 pb-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t("printers.title")}</h1>
      <p className="mt-2 text-base text-staff-soft">{t("printers.intro")}</p>

      <div className={`${card} mt-5 flex flex-wrap items-center gap-3`}>
        <label className="flex flex-wrap items-center gap-3 text-base font-semibold">
          {t("printers.pinLabel")}
          <input
            type="password"
            data-owner-pin
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            maxLength={32}
            className="min-h-12 w-40 rounded-md border border-staff-line-strong bg-staff-panel px-3 text-base"
          />
        </label>
        <span className="text-base text-staff-faint">
          {data && !data.pinConfigured ? t("printers.pinNotConfigured") : t("printers.pinHint")}
        </span>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-staff-danger-tint px-5 py-3 text-base font-medium text-staff-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 rounded-lg bg-staff-ink px-5 py-3 text-base font-medium text-white">
          {notice}
        </p>
      )}

      <h2 className="mt-8 text-xl font-semibold">{t("printers.listTitle")}</h2>
      <ul className="mt-3 flex flex-col gap-3">{assigned.map(printerCard)}</ul>

      <h2 className="mt-8 text-xl font-semibold">{t("printers.unassignedTitle")}</h2>
      {unassigned.length === 0 ? (
        <p className="mt-2 text-base text-staff-faint">{t("printers.unassignedEmpty")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">{unassigned.map(printerCard)}</ul>
      )}

      <h2 className="mt-8 text-xl font-semibold">{t("printers.routesTitle")}</h2>
      <ul className={`${card} mt-3 flex flex-col gap-3`}>
        {data?.routes.map((r) => (
          <li key={r.channel} className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-base font-semibold">{t(CHANNEL_KEY[r.channel])}</span>
            <select
              data-route={r.channel}
              value={r.role}
              disabled={busy}
              aria-label={t(CHANNEL_KEY[r.channel])}
              className={select}
              onChange={(e) => void change({ action: "route", channel: r.channel, role: e.target.value as PrinterRole })}
            >
              <option value="takeout">{t("printers.role.takeout")}</option>
              <option value="pos">{t("printers.role.pos")}</option>
            </select>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-xl font-semibold">{t("printers.copiesTitle")}</h2>
      <ul className={`${card} mt-3 flex flex-col gap-3`}>
        {data?.routes.map((r) => {
          const preset = presetFor(r.copyRoles);
          return (
            <li key={r.channel} className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-base font-semibold">{t(CHANNEL_KEY[r.channel])}</span>
              <select
                data-copies={r.channel}
                value={preset}
                disabled={busy}
                aria-label={t(CHANNEL_KEY[r.channel])}
                className={select}
                onChange={(e) => {
                  const chosen = COPY_PRESETS.find((p) => p.id === e.target.value);
                  if (chosen) void change({ action: "copies", channel: r.channel, copyRoles: chosen.roles });
                }}
              >
                {COPY_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {t(p.label)}
                  </option>
                ))}
                {preset === "custom" && (
                  <option value="custom">{t("printers.copies.custom", { roles: (r.copyRoles ?? []).join(", ") })}</option>
                )}
              </select>
            </li>
          );
        })}
      </ul>

      <h2 className="mt-8 text-xl font-semibold">{t("printers.auditTitle")}</h2>
      {data && data.audit.length === 0 ? (
        <p className="mt-2 text-base text-staff-faint">{t("printers.auditEmpty")}</p>
      ) : (
        <ul className={`${card} mt-3 flex flex-col divide-y divide-staff-line`}>
          {data?.audit.map((a) => (
            <li key={a.id} className="py-2 text-base">
              <span className="text-staff-faint">{new Date(a.at).toLocaleString("en-US")}</span>
              {" · "}
              <span className="font-semibold">
                {a.action in ACTION_KEY ? t(ACTION_KEY[a.action]) : a.action}
              </span>
              {a.target ? ` · ${a.target}` : ""}
              {a.oldValue !== null || a.newValue !== null ? (
                <span className="block text-sm text-staff-soft">
                  {JSON.stringify(a.oldValue)} → {JSON.stringify(a.newValue)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

const ACTION_KEY: Record<string, KitchenKey> = {
  assign: "printers.action.assign",
  deactivate: "printers.action.deactivate",
  rename: "printers.action.rename",
  route: "printers.action.route",
  copies: "printers.action.copies",
  pin_failed: "printers.action.pin_failed",
};
