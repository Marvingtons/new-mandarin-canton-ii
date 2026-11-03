"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { logoutAction } from "@/app/[kitchenSlug]/actions";
import { useKitchenI18n } from "@/components/kitchen/KitchenI18n";
import type { KitchenKey } from "@/lib/kitchen/i18n";
import Icon from "@/components/kitchen/Icon";

export type KitchenSection = "board" | "pos" | "history";

/** Per-device 大字 preference. A tablet at the pass may want it; the office PC may not. */
const LARGE_TEXT_STORAGE_KEY = "nmc-kitchen-large-text";

const SECTIONS: { id: KitchenSection; path: string; label: KitchenKey }[] = [
  { id: "board", path: "", label: "nav.board" },
  { id: "pos", path: "/pos", label: "nav.pos" },
  { id: "history", path: "/history", label: "nav.history" },
];

/**
 * The staff area's top bar: Board · New Order · History, the 中文 / EN toggle,
 * and sign out. Sticky, so on a long board or a long history page the way to
 * the order screen is always one tap away.
 *
 * `basePath` is the configured kitchen path (lib/kitchenRoute), passed down
 * from the server: the slug is never written into client code.
 */
export default function KitchenShell({
  basePath,
  active,
  children,
}: {
  basePath: string;
  active: KitchenSection;
  children: React.ReactNode;
}) {
  const { lang, setLang, t } = useKitchenI18n();
  const headerRef = useRef<HTMLElement>(null);

  /* 大字. Read after mount (storage is client-only, and the server render
     must match the first client render), then written to the surface as an
     attribute that globals.css scales the whole staff area from. */
  const [largeText, setLargeText] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLargeText(localStorage.getItem(LARGE_TEXT_STORAGE_KEY) === "1");
    } catch {
      /* storage blocked: default size */
    }
  }, []);
  useEffect(() => {
    const surface = headerRef.current?.closest("[data-kitchen-surface]");
    if (!surface) return;
    if (largeText) surface.setAttribute("data-large-text", "");
    else surface.removeAttribute("data-large-text");
  }, [largeText]);
  function toggleLargeText() {
    setLargeText((on) => {
      try {
        localStorage.setItem(LARGE_TEXT_STORAGE_KEY, on ? "0" : "1");
      } catch {
        /* storage blocked: still applies for this visit */
      }
      return !on;
    });
  }

  /* The nav's own height, for screens that fill what is left under it (the
     POS panes). Measured rather than assumed, because it changes with the
     type scale, 大字, and wrapping on a narrow screen. */
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const publish = () =>
      document.documentElement.style.setProperty("--kitchen-nav-h", `${header.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <header ref={headerRef} className="sticky top-0 z-30 border-b border-staff-line bg-staff-panel/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
          <nav
            aria-label={t("nav.main")}
            className="flex w-full gap-1 rounded-lg bg-staff-sunken p-1 sm:w-auto"
          >
            {SECTIONS.map((s) => {
              const current = s.id === active;
              return (
                <Link
                  key={s.id}
                  href={`${basePath}${s.path}`}
                  aria-current={current ? "page" : undefined}
                  className={`flex min-h-12 flex-1 items-center justify-center whitespace-nowrap rounded-md px-4 text-base font-semibold transition-colors sm:flex-none sm:px-5 ${
                    current
                      ? "bg-staff-panel text-staff-ink shadow-[0_1px_2px_rgba(27,26,23,0.12)]"
                      : "text-staff-soft hover:text-staff-ink"
                  }`}
                >
                  {t(s.label)}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleLargeText}
              aria-pressed={largeText}
              className={`flex min-h-12 items-center gap-2 rounded-lg border-2 px-3 text-base font-semibold transition-colors ${
                largeText
                  ? "border-staff-ink bg-staff-ink text-staff-panel"
                  : "border-staff-line-strong bg-staff-panel text-staff-ink hover:bg-staff-sunken"
              }`}
            >
              <Icon name="type" size={20} />
              {t("nav.largeText")}
            </button>
            <div
              role="group"
              aria-label={t("nav.language")}
              className="flex gap-1 rounded-lg bg-staff-sunken p-1"
            >
              {(["zh-Hant", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLang(l)}
                  aria-pressed={lang === l}
                  className={`min-h-12 min-w-14 rounded-md px-3 text-base font-semibold transition-colors ${
                    lang === l
                      ? "bg-staff-panel text-staff-ink shadow-[0_1px_2px_rgba(27,26,23,0.12)]"
                      : "text-staff-soft hover:text-staff-ink"
                  }`}
                >
                  {t(l === "zh-Hant" ? "lang.zh" : "lang.en")}
                </button>
              ))}
            </div>

            <form action={logoutAction}>
              <button
                type="submit"
                className="flex min-h-12 items-center gap-2 rounded-md px-3 text-base font-medium text-staff-soft transition-colors hover:bg-staff-sunken hover:text-staff-ink"
              >
                <Icon name="logOut" size={18} />
                {t("nav.signOut")}
              </button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
