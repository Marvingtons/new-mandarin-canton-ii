"use client";

import { createContext, useContext, useMemo } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { translator, type Translate } from "@/lib/i18n/dictionary";

/**
 * The locale, decided ONCE on the server and handed down.
 *
 * The provider takes the resolved locale as a prop rather than reading
 * the cookie itself, so the server render and the first client render
 * cannot disagree — the whole reason the brief asked for a cookie rather
 * than localStorage. No effect, no flash, no second paint in the other
 * language.
 */
const LocaleContext = createContext<{ locale: Locale; t: Translate }>({
  locale: DEFAULT_LOCALE,
  t: translator(DEFAULT_LOCALE),
});

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({ locale, t: translator(locale) }),
    [locale],
  );
  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

/** `const { t, locale } = useLocale()` in any client component. */
export function useLocale() {
  return useContext(LocaleContext);
}

/** Just the translator, for the common case. */
export function useT(): Translate {
  return useContext(LocaleContext).t;
}
