"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { logoutAction } from "@/app/[kitchenSlug]/actions";
import { useKitchenI18n } from "@/components/kitchen/KitchenI18n";
import { KitchenLiveProvider, useKitchenLive, type LiveSnapshot } from "@/components/kitchen/KitchenLive";
import { PrinterAlerts, PrinterStatusStrip } from "@/components/kitchen/PrinterStatusStrip";
import { SECTIONS, type KitchenSection } from "@/components/kitchen/kitchenSections";
import Icon from "@/components/kitchen/Icon";
import Button from "@/components/kitchen/ui/Button";
import { buttonClass } from "@/components/kitchen/ui/buttonClass";
import ShortcutHelp from "@/components/kitchen/ui/ShortcutHelp";
import { ToastProvider } from "@/components/kitchen/ui/Toasts";
import { useShortcuts } from "@/components/kitchen/ui/shortcuts";
import ui from "@/components/kitchen/ui/ui.module.css";

export type { KitchenSection };

/** Per-device 大字 preference. A tablet at the pass may want it; the office laptop may not. */
const LARGE_TEXT_STORAGE_KEY = "nmc-kitchen-large-text";

/**
 * THE STAFF APP'S ONE SHELL. Every staff screen (orders, new order, history)
 * renders inside it: the same header, the same printer strip, the same
 * toasts, the same live data. The POS no longer draws a bar of its own, so
 * nothing marks where "the website's orders" end and "the counter" begins.
 *
 * `basePath` is the configured kitchen path (lib/kitchenRoute), passed down
 * from the server: the slug is never written into client code.
 */
export default function KitchenShell({
  basePath,
  active,
  ordersConfigured,
  initial,
  children,
}: {
  basePath: string;
  active: KitchenSection;
  ordersConfigured: boolean;
  /** Server-read orders and printers for the first paint. */
  initial: LiveSnapshot | null;
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <KitchenLiveProvider ordersConfigured={ordersConfigured} initial={initial}>
        <ShellFrame basePath={basePath} active={active}>
          {children}
        </ShellFrame>
      </KitchenLiveProvider>
    </ToastProvider>
  );
}

function useLargeText(): [boolean, () => void] {
  const [largeText, setLargeText] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading a device preference once
      setLargeText(localStorage.getItem(LARGE_TEXT_STORAGE_KEY) === "1");
    } catch {
      /* storage blocked: default size */
    }
  }, []);
  useEffect(() => {
    const surface = document.querySelector("[data-kitchen-surface]");
    if (!surface) return;
    if (largeText) surface.setAttribute("data-large-text", "");
    else surface.removeAttribute("data-large-text");
  }, [largeText]);
  const toggle = useCallback(() => {
    const next = !largeText;
    setLargeText(next);
    try {
      localStorage.setItem(LARGE_TEXT_STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* still applies for this visit */
    }
  }, [largeText]);
  return [largeText, toggle];
}

function ShellFrame({
  basePath,
  active,
  children,
}: {
  basePath: string;
  active: KitchenSection;
  children: React.ReactNode;
}) {
  const { lang, setLang, t } = useKitchenI18n();
  const { orders, status, muted, toggleMute } = useKitchenLive();
  const router = useRouter();
  const topRef = useRef<HTMLDivElement>(null);
  const [largeText, toggleLargeText] = useLargeText();
  const [helpOpen, setHelpOpen] = useState(false);

  /* The header's real height (it wraps at 768px, grows under 大字, and a
     printer banner may sit under it), published for screens that fill what is
     left: the POS sizes its panes against --staff-header-h. */
  useEffect(() => {
    const top = topRef.current;
    const surface = document.querySelector<HTMLElement>("[data-kitchen-surface]");
    if (!top || !surface) return;
    const publish = () => surface.style.setProperty("--staff-header-h", `${top.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(top);
    return () => observer.disconnect();
  }, []);

  const go = useCallback((section: KitchenSection) => {
    const target = SECTIONS.find((s) => s.id === section);
    if (target) router.push(`${basePath}${target.path}`);
  }, [router, basePath]);

  useShortcuts({
    n: () => go("pos"),
    b: () => go("board"),
    h: () => go("history"),
    m: toggleMute,
    "?": () => setHelpOpen(true),
  });

  // Orders nobody has picked up yet, on the Orders tab, so a new one is
  // visible from the POS and from history too.
  const waiting = orders.filter((o) => o.status === "QUEUED" || o.status === "PRINTED" || o.status === "PRINT_FAILED").length;

  return (
    <>
      <div ref={topRef} className="sticky top-0 z-30">
        <header className="border-b border-staff-line bg-staff-panel">
          <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
            {/* eslint-disable-next-line @next/next/no-img-element -- a 40px vector seal, no optimisation to gain */}
            <img src="/brand/fu-yuan-seal.svg" alt="" width={20} height={34} className="h-9 w-auto" />

            <nav aria-label={t("nav.main")} className={ui.seg}>
              {SECTIONS.map((s) => (
                <Link key={s.id} href={`${basePath}${s.path}`} aria-current={s.id === active ? "page" : undefined}>
                  <Icon name={s.icon} size={20} />
                  {t(s.label)}
                  {s.id === "board" && waiting > 0 && (
                    <span className={ui.count} aria-label={t("board.newOrders", { n: waiting })}>
                      {waiting}
                    </span>
                  )}
                </Link>
              ))}
            </nav>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <PrinterStatusStrip />
              <span
                role="status"
                className={`hidden items-center gap-1.5 px-1 text-staff-caption lg:inline-flex ${
                  status === "reconnecting" ? "font-semibold text-staff-brand" : "text-staff-soft"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full ${status === "reconnecting" ? "bg-staff-brand" : "bg-staff-ink"}`}
                />
                {status === "reconnecting" ? t("board.reconnecting") : t("board.live")}
              </span>
              <Button
                variant="quiet"
                size="sm"
                iconOnly
                icon={muted ? "bellOff" : "bell"}
                aria-pressed={!muted}
                aria-label={t("nav.sound")}
                title={t("nav.sound")}
                onClick={toggleMute}
              />
              <MoreMenu
                lang={lang}
                onLang={() => setLang(lang === "zh-Hant" ? "en" : "zh-Hant")}
                largeText={largeText}
                onLargeText={toggleLargeText}
                onShortcuts={() => setHelpOpen(true)}
              />
            </div>
          </div>
        </header>
        <PrinterAlerts />
      </div>
      {children}
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
    </>
  );
}

/** Language, 大字, shortcuts and sign out: once a shift, so behind ⋯. */
function MoreMenu({
  lang,
  onLang,
  largeText,
  onLargeText,
  onShortcuts,
}: {
  lang: string;
  onLang: () => void;
  largeText: boolean;
  onLargeText: () => void;
  onShortcuts: () => void;
}) {
  const { t } = useKitchenI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = buttonClass({ variant: "quiet", block: true }, "justify-start");

  return (
    <div ref={ref} className="relative">
      <Button
        variant="quiet"
        size="sm"
        iconOnly
        icon="more"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("nav.more")}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div
          role="menu"
          aria-label={t("nav.more")}
          className={`${ui.card} absolute top-[calc(100%+0.5rem)] right-0 z-40 flex min-w-[16rem] flex-col p-2 shadow-staff-raised`}
        >
          <button type="button" role="menuitem" className={item} onClick={onLang}>
            <Icon name="globe" size={20} />
            {t("nav.language")}
            <span className="ml-auto text-staff-soft">{t(lang === "zh-Hant" ? "lang.en" : "lang.zh")}</span>
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={largeText} className={item} onClick={onLargeText}>
            <Icon name="type" size={20} />
            {t("nav.largeText")}
            {largeText && <Icon name="check" size={20} className="ml-auto text-staff-brand" />}
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onShortcuts();
            }}
          >
            <Icon name="note" size={20} />
            {t("shortcuts.title")}
            <kbd aria-hidden="true" className={`${ui.kbd} ml-auto`}>?</kbd>
          </button>
          <form action={logoutAction}>
            <button type="submit" role="menuitem" className={item}>
              <Icon name="logOut" size={20} />
              {t("nav.signOut")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
