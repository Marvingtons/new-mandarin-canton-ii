"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { logoutAction } from "@/app/[kitchenSlug]/actions";
import { useKitchenI18n } from "@/components/kitchen/KitchenI18n";
import { SECTIONS, useKitchenChrome } from "@/components/kitchen/kitchenChrome";
import Icon from "@/components/kitchen/Icon";
import { posIcon } from "@/components/kitchen/posIcon";
import s from "@/components/kitchen/pos.module.css";

/**
 * The POS's one row of chrome, 72px (docs/kitchen-design.md, top bar): the
 * seal and name on the left, 外賣 / 堂食 in the centre, and three 56px tools on
 * the right: search, the other language, and ⋯. Board, History, lunch hours,
 * 大字 and Sign out live in ⋯: on this screen they are the way out, not the
 * work. While searching, the field takes the centre.
 */
export default function PosTopBar({
  mode,
  onMode,
  searchField,
  onSearch,
  lunch,
}: {
  mode: "takeout" | "dine_in";
  onMode: (mode: "takeout" | "dine_in") => void;
  /** The search field while searching, else null. */
  searchField: React.ReactNode;
  onSearch: () => void;
  /** The lunch-hours switch, when lunch is not already being served. */
  lunch: { on: boolean; toggle: () => void } | null;
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

  const row = `${s.btn} ${s.quiet}`;

  return (
    <header className={s.top}>
      <div className={s.brandmark}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a 40px vector seal, no optimisation to gain */}
        <img src="/brand/fu-yuan-seal.svg" alt="" width={24} height={40} />
        <span className={s.one}>
          {t("pos.brand")} <span className={s.k}>{t("pos.brandArea")}</span>
        </span>
      </div>

      {searchField ?? (
        <div role="group" aria-label={t("pos.mode")} className={s.seg}>
          {(["takeout", "dine_in"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              data-mode={m}
              onClick={() => onMode(m)}
              aria-label={t(m === "takeout" ? "pos.mode.takeout" : "pos.mode.dineIn")}
            >
              <span lang="zh-Hant" className={s.zh}>
                {t(m === "takeout" ? "pos.mode.takeoutZh" : "pos.mode.dineInZh")}
              </span>
              <span lang="en">{t(m === "takeout" ? "pos.mode.takeoutEn" : "pos.mode.dineInEn")}</span>
            </button>
          ))}
        </div>
      )}

      <div className={s.topRight}>
        <button type="button" onClick={onSearch} aria-label={t("pos.search")} className={`${s.btn} ${s.secondary} ${s.icon}`}>
          <Icon name="search" size={posIcon(24)} />
        </button>
        <button
          type="button"
          onClick={() => setLang(lang === "zh-Hant" ? "en" : "zh-Hant")}
          aria-label={t("nav.language")}
          className={`${s.btn} ${s.secondary} ${s.icon}`}
        >
          {t("pos.langOther")}
        </button>
        <div ref={menuRef} className={s.menuWrap}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={t("nav.more")}
            className={`${s.btn} ${s.secondary} ${s.icon}`}
          >
            <Icon name="more" size={posIcon(24)} />
          </button>
          {menuOpen && (
            <div role="menu" aria-label={t("nav.main")} className={s.menu}>
              {SECTIONS.filter((x) => x.id !== "pos").map((x) => (
                <Link key={x.id} role="menuitem" href={`${basePath}${x.path}`} className={row}>
                  <Icon name={x.id === "board" ? "columns" : "history"} size={posIcon(22)} />
                  {t(x.label)}
                </Link>
              ))}
              {lunch && (
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={lunch.on}
                  title={t("pos.lunchOverrideHint")}
                  onClick={lunch.toggle}
                  className={row}
                >
                  <Icon name="clock" size={posIcon(22)} />
                  {t("pos.lunchHours")}
                  {lunch.on && <Icon name="check" size={posIcon(22)} className={s.check} />}
                </button>
              )}
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={largeText}
                aria-label={t("nav.largeText")}
                onClick={toggleLargeText}
                className={row}
              >
                <Icon name="type" size={posIcon(22)} />
                {t("nav.largeText")}
                {largeText && <Icon name="check" size={posIcon(22)} className={s.check} />}
              </button>
              <form action={logoutAction}>
                <button type="submit" role="menuitem" className={row}>
                  <Icon name="logOut" size={posIcon(22)} />
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
