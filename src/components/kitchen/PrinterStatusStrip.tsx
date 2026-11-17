"use client";

import type { StationPrinterHealth } from "@/lib/print/printerStatus";
import type { KitchenKey } from "@/lib/kitchen/i18n";
import Icon, { type IconName } from "@/components/kitchen/Icon";
import { useKT } from "@/components/kitchen/KitchenI18n";
import { useKitchenLive } from "@/components/kitchen/KitchenLive";
import ui from "@/components/kitchen/ui/ui.module.css";

/**
 * THE ASSIGNED PRINTERS, ON SCREEN. A chip per printer that has a MAC set
 * (CLOUDPRNT_PRINTER_MAC_ONLINE / _STORE) in the header of every staff page,
 * so "why has the kitchen gone quiet" is a glance and not a walk to the
 * printer. A station with no printer assigned is never drawn: its tickets
 * print on the other one, and a chip for a printer that does not exist only
 * makes staff look for it. When one needs a person, PrinterAlerts says which,
 * in one slim line under the header.
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
  const { printers: all, printersConfigured, status } = useKitchenLive();
  const printers = all.filter((p) => p.configured);

  if (!printersConfigured) {
    return (
      <span role="status" className={`${ui.pill} min-h-11 bg-staff-sunken text-staff-ink`}>
        <Icon name="printer" size={18} />
        {t("printer.short.none")}
      </span>
    );
  }

  if (all.length === 0) {
    // First load: the chips' own shape, so the header does not jump.
    return (
      <span aria-hidden="true" className="flex gap-2">
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
          // Upright, a healthy chip steps out of the 64px header.
          <li key={p.station} className={lookOf(p) === "ok" ? "portrait:hidden" : undefined}>
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
 * The printer empty state: ONE slim line under the header on every staff
 * page, only when an assigned printer needs a person, with the next step in
 * words. Never a stack of banners: two printers in trouble share the line.
 * Gold for "do something soon", lacquer for "nothing is printing".
 *
 * Only assigned printers count. A station with no MAC set is "not-set-up",
 * which is a setup choice and never a fault, so "Store printer offline"
 * cannot appear before printer B is installed and its MAC is set.
 */
export function PrinterAlerts() {
  const t = useKT();
  const { printers, printersConfigured } = useKitchenLive();
  if (!printersConfigured) return null;

  // A station covered by the other printer is not separately broken: its
  // chip already says where it prints, and the covering printer's own line
  // covers it.
  const needs = printers.filter((p) => p.configured && p.printedBy === p.station && helpKey(p) !== null);
  if (needs.length === 0) return null;

  const looks = needs.map(lookOf);
  const urgent = looks.some((l) => l === "offline" || l === "blocked");
  const tone = looks.includes("offline")
    ? "bg-staff-brand text-staff-on-brand"
    : looks.includes("blocked")
      ? "bg-staff-gold text-staff-ink"
      : "bg-staff-gold-tint text-staff-ink";
  const first = needs[0];
  const queued = needs.reduce((n, p) => n + p.queued, 0);
  const text = needs.map((p) => t(helpKey(p)!, { station: t(`station.${p.station}`) })).join(" · ");
  const detail = urgent
    ? [
        queued > 0 ? t("printer.queued", { n: queued }) : null,
        first.failoverTo ? t("printer.failoverTo", { station: t(`station.${first.failoverTo}`) }) : t("printer.help.reprintHint"),
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div
      role={urgent ? "alert" : "status"}
      data-printer-alert
      title={detail ?? undefined}
      className={`flex min-h-10 w-full items-center gap-3 px-4 text-staff-caption font-semibold sm:px-6 ${tone}`}
    >
      <Icon name="printer" size={20} />
      <span className="min-w-0 truncate">{text}</span>
      {detail && <span className="hidden min-w-0 truncate font-medium opacity-90 md:inline">{detail}</span>}
    </div>
  );
}
