"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { STATIONS, type Station } from "@/config/stations";
import { formatCents } from "@/lib/money";
import { CHANNEL_SCOPES, type ChannelScope, type DailyReport } from "@/lib/reports/dailyModel";
import type { PrinterHealth } from "@/lib/print/printerStatus";
import Icon from "@/components/kitchen/Icon";
import { useKitchenI18n } from "@/components/kitchen/KitchenI18n";
import Button from "@/components/kitchen/ui/Button";
import { Dialog } from "@/components/kitchen/ui/Dialog";
import Segmented from "@/components/kitchen/ui/Segmented";
import { Skeleton } from "@/components/kitchen/ui/Skeleton";
import ui from "@/components/kitchen/ui/ui.module.css";

/**
 * 日結 DAY REPORT print sheet, opened from History.
 *
 * Date (◀ ▶ a day at a time, never past today), 範圍 Scope (All / Online
 * only / Store only, by channel), the printer, and a live
 * preview drawn by the SAME renderer as the paper
 * (GET /api/kitchen/reports/daily/preview), so what is on the tablet is what
 * prints. Print is disabled, with the reason, while that printer is out of
 * paper, open or offline. See docs/daily-report.md.
 */

interface SheetData {
  ok: true;
  date: string;
  today: string;
  defaultDate: string;
  report: DailyReport;
  nextSequence: number;
  prints: Array<{ sequence: number; station: Station; status: "QUEUED" | "OFFERED" | "PRINTED" | "FAILED"; code: string; requestedAt: string }>;
  printers: Array<{ station: Station; health: PrinterHealth; blocked: boolean; printedBy: Station }>;
  suggestedStation: Station;
  ticketsToday: Record<Station, number>;
  printable: boolean;
}

const SHORT: Record<PrinterHealth, "ok" | "offline" | "paperOut" | "coverOpen" | "unknown" | "notSetUp"> = {
  ok: "ok",
  offline: "offline",
  "paper-out": "paperOut",
  "cover-open": "coverOpen",
  unknown: "unknown",
  "not-set-up": "notSetUp",
};

function shiftDay(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function DailyReportSheet({ onClose }: { onClose: () => void }) {
  const { t, lang } = useKitchenI18n();
  // The day asked for; null = the server's default (today, or yesterday
  // before 4am). What is SHOWN is data.date, the day the server answered.
  const [requested, setRequested] = useState<string | null>(null);
  const [scope, setScope] = useState<ChannelScope>("all");
  // The printer: the server's suggestion (fewer tickets today) until staff
  // pick one themselves.
  const [picked, setPicked] = useState<Station | null>(null);
  const [data, setData] = useState<SheetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  // One key per press: a retried request after a dropped connection is the
  // same print, never a second (the route is idempotent on it).
  const pressKey = useRef<string | null>(null);

  const load = useCallback(async (day: string | null, which: ChannelScope) => {
    try {
      const q = new URLSearchParams({ ...(day ? { date: day } : {}), ...(which === "all" ? {} : { scope: which }) });
      const res = await fetch(`/api/kitchen/reports/daily${q.size ? `?${q.toString()}` : ""}`, { cache: "no-store" });
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      const body = (await res.json()) as SheetData | { ok: false };
      if (!body.ok) {
        setError(t("report.loadFailed"));
        return;
      }
      setData(body);
      setError(null);
    } catch {
      setError(t("report.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(requested, scope);
  }, [load, requested, scope]);

  const station: Station = picked ?? data?.suggestedStation ?? "store";

  const day = data?.date ?? requested;
  const printer = data?.printers.find((p) => p.station === station) ?? null;
  const printerName = t("station.printer", { station: t(`station.${station}`) });
  const blockedReason =
    data && !data.printable
      ? t("report.notSetUp")
      : printer?.blocked
        ? t("report.unavailable", { printer: printerName, reason: t(`printer.short.${SHORT[printer.health]}`) })
        : null;

  const previewSrc = data
    ? `/api/kitchen/reports/daily/preview?${new URLSearchParams({
        date: data.date,
        station,
        sequence: String(data.nextSequence),
        ...(scope === "all" ? {} : { scope }),
        v: data.report.code,
      }).toString()}`
    : null;

  const longDate = day
    ? new Intl.DateTimeFormat(lang === "en" ? "en-US" : "zh-Hant-TW", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${day}T12:00:00Z`))
    : "";

  async function print() {
    if (!data || blockedReason || printing) return;
    setPrinting(true);
    setNotice(null);
    pressKey.current ??= newKey();
    try {
      const res = await fetch("/api/kitchen/reports/daily/print", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date: data.date,
          station,
          scope,
          sequence: data.nextSequence,
          requestKey: pressKey.current,
        }),
      });
      const body = (await res.json()) as { ok: boolean; print?: { sequence: number }; nextSequence?: number; error?: string };
      if (body.ok && body.print) {
        pressKey.current = null;
        setNotice(t("report.sent", { n: body.print.sequence, printer: printerName }));
        await load(data.date, scope);
      } else if (res.status === 409 && body.nextSequence) {
        pressKey.current = null;
        setNotice(t("report.taken", { n: body.nextSequence }));
        await load(data.date, scope);
      } else if (res.status === 409) {
        await load(data.date, scope);
      } else {
        setNotice(t("report.failed"));
      }
    } catch {
      setNotice(t("report.failed"));
    } finally {
      setPrinting(false);
    }
  }

  return (
    <Dialog title={t("report.title")} onClose={onClose} wide>
      <div className="grid gap-6 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
        <div className="flex min-w-0 flex-col gap-5">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-staff-body font-semibold">{t("report.date")}</legend>
            <div className="flex items-center gap-2">
              <Button
                iconOnly
                icon="chevronLeft"
                aria-label={t("report.prevDay")}
                disabled={!day}
                onClick={() => day && setRequested(shiftDay(day, -1))}
              />
              <output
                aria-live="polite"
                className="flex min-h-14 min-w-0 flex-1 items-center justify-center rounded-staff-control bg-staff-sunken px-3 text-center text-staff-body font-semibold tabular-nums"
              >
                {longDate}
              </output>
              <Button
                iconOnly
                icon="chevronRight"
                aria-label={t("report.nextDay")}
                disabled={!day || !data || day >= data.today}
                onClick={() => day && setRequested(shiftDay(day, 1))}
              />
            </div>
            {data && (
              <p className="text-staff-body tabular-nums" data-testid="report-summary">
                {t("report.summary", { n: data.report.columns.all.count, total: formatCents(data.report.columns.all.totalCents) })}
              </p>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-2" data-testid="report-scope">
            <legend className="mb-2 text-staff-body font-semibold">{t("report.scope")}</legend>
            <Segmented
              label={t("report.scope")}
              value={scope}
              onChange={setScope}
              options={CHANNEL_SCOPES.map((s) => ({ value: s, label: t(`report.scope.${s}`) }))}
            />
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-staff-body font-semibold">{t("report.printer")}</legend>
            <Segmented
              label={t("report.printer")}
              value={station}
              onChange={setPicked}
              options={STATIONS.map((s) => ({
                value: s,
                label: (
                  <>
                    <Icon name={s === "online" ? "globe" : "store"} size={20} />
                    {t("station.printer", { station: t(`station.${s}`) })}
                  </>
                ),
              }))}
            />
            {data && picked === null && (
              <p className="text-staff-caption text-staff-soft" data-testid="report-printer-suggested">
                {t("report.printerSuggested", { online: data.ticketsToday.online, store: data.ticketsToday.store })}
              </p>
            )}
          </fieldset>

          {data && data.prints.length > 0 && (
            <section className="flex flex-col gap-1">
              <h3 className="text-staff-caption font-semibold text-staff-soft">{t("report.earlier")}</h3>
              <ul className="flex flex-col gap-1 text-staff-caption tabular-nums" data-testid="report-earlier">
                {data.prints.map((p) => (
                  <li key={p.sequence} className="flex flex-wrap gap-x-2">
                    <span className="font-semibold" data-testid="report-earlier-seq">#{p.sequence}</span>
                    <span>{t(`station.${p.station}`)}</span>
                    <span>{t(`report.status.${p.status}`)}</span>
                    <span className="text-staff-soft">{p.code}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {error && <p role="alert" className="text-staff-body">{error}</p>}
          {notice && <p role="status" className="text-staff-body font-semibold" data-testid="report-notice">{notice}</p>}
          {blockedReason && <p role="note" className="text-staff-body">{blockedReason}</p>}

          <div className={`${ui.dialogActions} mt-auto`}>
            <Button variant="secondary" onClick={onClose}>
              {t("report.close")}
            </Button>
            <Button
              variant="primary"
              icon="printer"
              busy={printing}
              disabled={!data || blockedReason !== null || printing}
              onClick={() => void print()}
              data-testid="report-print"
            >
              {t("report.print", { n: data?.nextSequence ?? 1 })}
            </Button>
          </div>
          <p className="text-staff-caption text-staff-soft">{t("report.asOf")}</p>
        </div>

        <figure className="flex min-w-0 flex-col gap-2">
          <figcaption className="text-staff-caption font-semibold text-staff-soft">{t("report.preview")}</figcaption>
          <div className="max-h-[70svh] overflow-y-auto overflow-x-hidden rounded-staff-control bg-staff-sunken p-3">
            {previewSrc ? (
              // A same-origin PNG the server renders per request; next/image's
              // optimizer would only re-encode a 1-bit receipt.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewSrc}
                alt={t("report.previewAlt", { date: longDate })}
                className="mx-auto block h-auto w-full max-w-[22rem] shadow-staff-raised"
                data-testid="report-preview"
              />
            ) : (
              <Skeleton className="mx-auto h-[36rem] w-full max-w-[22rem]" />
            )}
          </div>
        </figure>
      </div>
    </Dialog>
  );
}
