"use client";

import type { StationPrinterHealth } from "@/lib/print/printerStatus";
import type { KitchenKey } from "@/lib/kitchen/i18n";
import Icon, { type IconName } from "@/components/kitchen/Icon";
import { useKT } from "@/components/kitchen/KitchenI18n";
import { useKitchenLive } from "@/components/kitchen/KitchenLive";
import ui from "@/components/kitchen/ui/ui.module.css";

/**
 * BOTH PRINTERS, ALWAYS ON SCREEN. Two chips in the header of every staff
 * page, Online and Store, so "why has the kitchen gone quiet" is a glance and
 * not a walk to the printer. When one needs a person, PrinterAlerts (below the
 * header) says which, and exactly what to do.
 */

type Look = "ok" | "low" | "blocked" | "offline" | "unknown" | "unset";

function lookOf(p: StationPrinterHealth): Look {
  if (p.health === "not-set-up") return "unset";
  if (p.health === "offline") return "offline";
  if (p.health === "paper-out" || p.health === "cover-open") return "blocked";
  if (p.health === "unknown") return "unknown";
  if (p.paperLow) return "low";
  return "ok";
}

const CHIP: Record<Look, { className: string; icon: IconName }> = {
  ok: { className: "bg-staff-panel text-staff-ink shadow-[inset_0_0_0_1px_var(--color-staff-line)]", icon: "check" },
  low: { className: "bg-staff-gold-tint text-staff-ink", icon: "alert" },
  blocked: { className: "bg-staff-gold text-staff-ink", icon: "alert" },
  offline: { className: "bg-staff-brand text-staff-on-brand", icon: "alert" },
  unknown: { className: "bg-staff-sunken text-staff-ink", icon: "circle" },
  // Neutral and quiet on purpose: no printer configured is a setup choice,
  // not a fault.
  unset: { className: "bg-staff-sunken text-staff-ink opacity-80", icon: "circle" },
};

function shortKey(p: StationPrinterHealth): KitchenKey {
  switch (p.health) {
    case "offline":
      return "printer.short.offline";
    case "paper-out":
      return "printer.short.paperOut";
    case "cover-open":
      return "printer.short.coverOpen";
    case "unknown":
      return "printer.short.unknown";
    case "not-set-up":
      return "printer.short.notSetUp";
    default:
      return p.paperLow ? "printer.short.paperLow" : "printer.short.ok";
  }
}

function helpKey(p: StationPrinterHealth): KitchenKey | null {
  switch (p.health) {
    case "offline":
      return "printer.help.offline";
    case "paper-out":
      return "printer.help.paperOut";
    case "cover-open":
      return "printer.help.coverOpen";
    case "unknown":
      return "printer.help.unknown";
    case "not-set-up":
      // Not a fault: no banner, ever.
      return null;
    default:
      return p.paperLow ? "printer.help.paperLow" : null;
  }
}

/** The two chips. Compact enough to sit in the header at 768px. */
export function PrinterStatusStrip() {
  const t = useKT();
  const { printers, printersConfigured, status } = useKitchenLive();

  if (!printersConfigured) {
    return (
      <span role="status" className={`${ui.pill} min-h-11 bg-staff-sunken text-staff-ink`}>
        <Icon name="printer" size={18} />
        {t("printer.short.none")}
      </span>
    );
  }

  if (printers.length === 0) {
    // First load: the chips' own shape, so the header does not jump.
    return (
      <span aria-hidden="true" className="flex gap-2">
        <span className={`${ui.skeleton} h-11 w-32`} />
        <span className={`${ui.skeleton} h-11 w-32`} />
      </span>
    );
  }

  return (
    <ul aria-label={t("printer.strip")} className="flex items-center gap-2" data-stale={status === "reconnecting" || undefined}>
      {printers.map((p) => {
        const look = CHIP[lookOf(p)];
        const station = t(`station.${p.station}`);
        const state = t(shortKey(p));
        const covered = p.printedBy !== p.station;
        return (
          <li key={p.station}>
            <span
              role="status"
              aria-label={`${t("station.printer", { station })}: ${state}${covered ? `, ${t("printer.coveredBy", { station: t(`station.${p.printedBy}`) })}` : ""}${p.queued > 0 ? `, ${t("printer.queued", { n: p.queued })}` : ""}`}
              className={`${ui.pill} min-h-11 gap-2 px-3 text-staff-caption ${look.className}`}
            >
              <Icon name={look.icon} size={16} />
              <span className="font-semibold">{station}</span>
              <span aria-hidden="true" className="opacity-60">·</span>
              <span className="font-medium">{state}</span>
              {p.queued > 0 && lookOf(p) !== "ok" && (
                <span className={`${ui.count} ml-1`}>{p.queued}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The printer empty state: one slim line under the header on every staff
 * page, naming each printer that needs a person and the next step in words.
 * Gold for "do something soon", a lacquer tint for "nothing is printing".
 */
export function PrinterAlerts() {
  const t = useKT();
  const { printers, printersConfigured } = useKitchenLive();
  if (!printersConfigured) return null;

  // A station covered by the other printer is not separately broken: its
  // chip already says where it prints, and the covering printer's own banner
  // covers it.
  const needs = printers.filter((p) => p.printedBy === p.station && helpKey(p) !== null);
  if (needs.length === 0) return null;

  /* ONE LINE, however many printers need a person: each is a chip (the
     station and its state, in the strip's colours) and the next step in
     words, cut with an ellipsis when it must be. The full text is the
     line's title, and the chip in the header says the same. A tall banner
     here pushed the POS's dishes below the fold at 1024x768. */
  const urgentAny = needs.some((p) => {
    const look = lookOf(p);
    return look === "offline" || look === "blocked";
  });
  const words = needs
    .map((p) => {
      const station = t(`station.${p.station}`);
      const look = lookOf(p);
      const urgent = look === "offline" || look === "blocked";
      const tail = urgent
        ? p.failoverTo
          ? t("printer.failoverTo", { station: t(`station.${p.failoverTo}`) })
          : t("printer.help.reprintHint")
        : "";
      return [t(helpKey(p)!, { station }), tail].filter(Boolean).join(" ");
    })
    .join(" · ");

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pt-2 sm:px-6" data-printer-alerts>
      <div
        role={urgentAny ? "alert" : "status"}
        title={words}
        className={`flex min-h-11 items-center gap-3 overflow-hidden rounded-staff-control px-3 text-staff-caption ${
          urgentAny ? "bg-staff-brand-tint text-staff-ink" : "bg-staff-gold-tint text-staff-ink"
        }`}
      >
        <Icon name="printer" size={20} className="shrink-0" />
        {needs.map((p) => {
          const look = CHIP[lookOf(p)];
          return (
            <span key={p.station} className={`${ui.pill} shrink-0 gap-1.5 px-2.5 ${look.className}`}>
              <Icon name={look.icon} size={14} />
              <span className="font-semibold">{t(`station.${p.station}`)}</span>
              <span aria-hidden="true" className="opacity-60">·</span>
              <span>{t(shortKey(p))}</span>
              {p.queued > 0 && <span className={`${ui.count} ml-1`}>{p.queued}</span>}
            </span>
          );
        })}
        <span className="min-w-0 flex-1 truncate">{words}</span>
      </div>
    </div>
  );
}
