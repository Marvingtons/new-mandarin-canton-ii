"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/LocaleContext";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  type Locale,
} from "@/lib/i18n/locale";

/**
 * EN | ES, in the header.
 *
 * Two buttons rather than a select or a globe icon: there are exactly two
 * languages, both fit, and a customer should be able to see which one is
 * active without opening anything. The inactive one is the tap target;
 * the active one is a state, marked `aria-current` and not clickable.
 *
 * Writes the cookie and calls router.refresh(). The cookie is what the
 * ROOT LAYOUT reads to pick the strings and the <html lang>, so the
 * refresh is what makes the server re-render in the new language — this
 * is deliberately not client-side state, because state would mean the
 * first paint of every future page load is in the wrong language until
 * JavaScript arrives.
 *
 * NOT httpOnly (see lib/i18n/locale.ts): it says "es", it guards nothing,
 * and a route handler purely to change language would be silly.
 *
 * There is no mobile drawer to put this in — the header's nav is always
 * visible and simply wraps at small widths — so the toggle sits beside
 * the nav at every size.
 */
/**
 * Module scope, not inline in the handler.
 *
 * `document.cookie = …` inside a component body trips
 * react-hooks/immutability ("modifying a variable defined outside a
 * component"), which reads the assignment as component-level mutation
 * rather than as the browser API it is. Writing a cookie in a click
 * handler is exactly what that rule is not about, so the escape is to
 * move the write out of the component rather than to disable the rule.
 */
function writeLocaleCookie(next: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}

export default function LocaleToggle({
  className = "",
}: {
  className?: string;
}) {
  const { locale, t } = useLocale();
  const router = useRouter();

  const choose = (next: Locale) => {
    if (next === locale) return;
    writeLocaleCookie(next);
    router.refresh();
  };

  return (
    <div
      className={`flex items-center gap-1 text-xs uppercase tracking-[0.15em] ${className}`}
      role="group"
      aria-label={t("lang.label")}
    >
      {(["en", "es"] as const).map((code, i) => {
        const active = locale === code;
        return (
          <span key={code} className="flex items-center">
            {i > 0 && (
              <span aria-hidden="true" className="px-1 text-ivory/35">
                |
              </span>
            )}
            <button
              type="button"
              onClick={() => choose(code)}
              aria-current={active ? "true" : undefined}
              // The active one is not a control. Announcing a button that
              // does nothing is how a screen reader user ends up tapping
              // it to find out.
              disabled={active}
              lang={code}
              // ivory/85 on the inactive one, not /70. The INACTIVE button is
              // the only tap target in the pair — the active one is a
              // disabled state — and at /70 on lacquer it measured 4.24:1,
              // just under what a 12px control needs. /85 is 5.6:1 and still
              // sits visibly behind the gold-light active label.
              className={
                active
                  ? "font-semibold text-gold-light"
                  : "token-colors text-ivory/85 underline-offset-4 hover:text-gold-light hover:underline"
              }
              title={
                active
                  ? undefined
                  : code === "es"
                    ? t("lang.switchToEs")
                    : t("lang.switchToEn")
              }
            >
              {code === "en" ? t("lang.en") : t("lang.es")}
            </button>
          </span>
        );
      })}
    </div>
  );
}
