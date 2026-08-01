/**
 * The two languages the ENGLISH layer of this site can be in.
 *
 * 中文 is not one of them, and that is the design. This restaurant is
 * Chinese-forward by identity: 富源 is on the header, the dish names carry
 * their own 中文, and every functional notice reads "English · 中文".
 * Spanish replaces the ENGLISH half of that pairing, so a Spanish speaker
 * in Chula Vista reads "Español · 中文" and the Chinese never moves. A
 * third "language" that removed the 中文 would be a different website.
 */
export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** The cookie the toggle writes and the server reads. */
export const LOCALE_COOKIE = "nmc_lang";

/**
 * A year. This is a preference, not a session: somebody who reads Spanish
 * this week reads Spanish next week, and asking again is the kind of
 * small rudeness that makes a toggle feel broken.
 */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * NOT httpOnly, deliberately, and the only cookie on this site that isn't.
 *
 * The toggle is a client component: it writes this from JavaScript and
 * the server reads it back. There is nothing to protect — it says
 * "es" — and making it httpOnly would mean a route handler just to
 * change language. Every cookie that guards anything (nmc_phone,
 * nmc_verified, nmc_kitchen, nmc_test_mode) stays httpOnly and signed;
 * see /privacy, which describes them.
 */
export function isLocale(value: string | undefined): value is Locale {
  return value === "en" || value === "es";
}

/** Narrow an untrusted cookie value to a locale, falling back to English. */
export function toLocale(value: string | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** What goes in the `lang` attribute of <html>. */
export function htmlLang(locale: Locale): string {
  return locale === "es" ? "es" : "en";
}
