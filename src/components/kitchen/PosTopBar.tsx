"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { logoutAction } from "@/app/[kitchenSlug]/actions";
import { useKitchenI18n } from "@/components/kitchen/KitchenI18n";
import { SECTIONS, useKitchenChrome } from "@/components/kitchen/kitchenChrome";
import Icon from "@/components/kitchen/Icon";

/**
 * The POS's one row of chrome, 72px: service on the left, who or which table
 * in the middle (the `context` slot, a chip that opens its details), and the
 * quiet tools on the right. Board and History, which used to take a whole row
 * of tabs, live in the overflow menu: on this screen they are the way out,
 * not the work.
 */
export default function PosTopBar({
  mode,
  onMode,
  context,
  search,
  lunch,
}: {
  mode: "takeout" | "dine_in";
  onMode: (mode: "takeout" | "dine_in") => void;
  /** The context chip, or the search field while searching. */
  context: React.ReactNode;
  /** Opens search; null while the field is already open. */
  search: (() => void) | null;
  /** The lunch-hours chip, when there is one to show. */
  lunch: React.ReactNode;
}) {
  const { lang, setLang, t } = useKitchenI18n();
  const { basePath, largeText, toggleLargeText } = useKitchenChrome();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const tool =
    "flex h-[2.545rem] min-w-[2.545rem] items-center justify-center gap-2 rounded-xl px-3 text-base font-semibold whitespace-nowrap transition-colors";

  return (
    // A container, so a narrow bar (portrait, 大字) drops the English half of
    // 外賣 / 堂食 before it squeezes the context chip.
    <header className="@container/top flex h-[var(--pos-top)] items-center gap-3 bg-pos-bg px-[var(--pos-gap)] [grid-area:top]">
      {/* 外賣 | 堂食 */}
      <div role="group" aria-label={t("pos.mode")} className="flex shrink-0 gap-1 rounded-2xl bg-pos-sunken p-1">
        {(["takeout", "dine_in"] as const).map((m) => {
          const on = mode === m;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              data-mode={m}
              onClick={() => onMode(m)}
              aria-label={t(m === "takeout" ? "pos.mode.takeout" : "pos.mode.dineIn")}
              className={`flex h-[2.545rem] items-center gap-1.5 rounded-xl px-4 text-base font-bold whitespace-nowrap transition-colors ${
                on ? "bg-pos-brand text-white shadow-pos-card" : "text-pos-ink hover:bg-pos-card/60"
              }`}
            >
              <span lang="zh-Hant">{t(m === "takeout" ? "pos.mode.takeoutZh" : "pos.mode.dineInZh")}</span>
              <span lang="en" className="hidden @min-[52rem]/top:inline">
                {t(m === "takeout" ? "pos.mode.takeoutEn" : "pos.mode.dineInEn")}
              </span>
            </button>
          );
        })}
      </div>

      <div className="@container/chip flex min-w-0 flex-1 justify-center">{context}</div>

      <div className="flex shrink-0 items-center gap-1">
        {search && (
          <button type="button" onClick={search} aria-label={t("pos.search")} className={`${tool} text-pos-ink hover:bg-pos-sunken`}>
            <Icon name="search" size={20} />
          </button>
        )}
        {lunch}
        <button
          type="button"
          onClick={toggleLargeText}
          aria-pressed={largeText}
          aria-label={t("nav.largeText")}
          className={`${tool} ${largeText ? "bg-pos-ink text-white" : "text-pos-ink hover:bg-pos-sunken"}`}
        >
          {t("nav.largeTextShort")}
        </button>
        <div role="group" aria-label={t("nav.language")} className="flex rounded-xl bg-pos-sunken p-0.5">
          {(["zh-Hant", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={`h-[2.364rem] min-w-[2.545rem] rounded-[10px] px-2.5 text-base font-semibold transition-colors ${
                lang === l ? "bg-pos-card text-pos-ink shadow-pos-card" : "text-pos-muted hover:text-pos-ink"
              }`}
            >
              {t(l === "zh-Hant" ? "lang.zh" : "lang.en")}
            </button>
          ))}
        </div>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={t("nav.more")}
            className={`${tool} ${menuOpen ? "bg-pos-sunken" : "hover:bg-pos-sunken"} text-pos-ink`}
          >
            <Icon name="more" size={22} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              aria-label={t("nav.main")}
              className="pos-sheet-in absolute top-full right-0 z-40 mt-2 flex w-max min-w-[11rem] flex-col rounded-pos bg-pos-card p-2 shadow-pos-raised"
            >
              {SECTIONS.filter((s) => s.id !== "pos").map((s) => (
                <Link
                  key={s.id}
                  role="menuitem"
                  href={`${basePath}${s.path}`}
                  className="flex min-h-[2.545rem] items-center gap-3 rounded-xl px-3 text-base font-semibold text-pos-ink hover:bg-pos-sunken"
                >
                  <Icon name={s.id === "board" ? "columns" : s.id === "printers" ? "printer" : "history"} size={20} className="text-pos-muted" />
                  {t(s.label)}
                </Link>
              ))}
              <form action={logoutAction} className="mt-1 pt-1">
                <button
                  type="submit"
                  role="menuitem"
                  className="flex min-h-[2.545rem] w-full items-center gap-3 rounded-xl px-3 text-base font-semibold text-pos-muted hover:bg-pos-sunken hover:text-pos-ink"
                >
                  <Icon name="logOut" size={20} />
                  {t("nav.signOut")}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
