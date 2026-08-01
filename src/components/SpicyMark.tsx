"use client";

import { useT } from "@/lib/i18n/LocaleContext";

/**
 * Spicy indicator. Deliberately NOT the 辣 character it used to be: a heat
 * warning is functional UI, and a guest who can't read it gets no warning at
 * all.
 *
 * It lives in its own client module rather than beside the menu row markup it
 * used to share a file with, because the word is now translated and a hook
 * cannot sit in a file that also exports a server-shaped component.
 */
export function SpicyMark() {
  const t = useT();
  return (
    <span className="inline-flex shrink-0 items-center self-center rounded-full border border-lacquer/40 px-1 text-xs uppercase leading-4 tracking-[0.12em] text-lacquer">
      {t("menu.spicy")}
    </span>
  );
}
