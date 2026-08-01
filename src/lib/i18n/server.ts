import "server-only";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, toLocale, type Locale } from "@/lib/i18n/locale";
import { translator, type Translate } from "@/lib/i18n/dictionary";

/**
 * The translator for SERVER components.
 *
 * useT() is a hook and needs the client context, which leaves the server
 * components with no way to translate anything — and two of them, Footer
 * and StickyOrderBar, are in the ROOT LAYOUT. Without this they would
 * render English on every page in both languages, which is the worst of
 * both worlds: a site that says "Menú" in the header and "Get Directions"
 * in the footer.
 *
 * Reading the cookie again here costs nothing: the root layout has
 * already opted every route into dynamic rendering (see app/layout.tsx
 * for the accounting), and Next dedupes cookies() within a request.
 */
export async function getLocale(): Promise<Locale> {
  return toLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}

/** `const t = await getT()` at the top of a server component. */
export async function getT(): Promise<Translate> {
  return translator(await getLocale());
}
