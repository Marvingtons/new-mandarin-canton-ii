import Link from "next/link";
import HorizonMark from "@/components/motifs/HorizonMark";
import PhoneLinks from "@/components/PhoneLinks";
import { getT } from "@/lib/i18n/server";

/**
 * 404. There wasn't one before this — an unmatched URL fell through to
 * Next's default, which is a bare system-font line on white and the only
 * page on the site that didn't look like the site.
 *
 * Root `not-found.tsx` catches every unmatched URL app-wide and renders
 * inside the root layout, so it keeps the header, the footer and the
 * back-to-top button. (`global-not-found` would bypass the layout and is
 * still experimental — see next/dist/docs/.../not-found.md.)
 *
 * This is the site's one full-colour motif placement. An error page is the
 * single place where a picture IS the content rather than decoration on
 * top of it, and a horizon is the right picture for having walked off the
 * edge of the map. Nothing else on the page competes with it: a heading,
 * two lines, and the two ways out that matter for a restaurant — the menu,
 * and the phone.
 */
export default async function NotFound() {
  const t = await getT();

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-20 text-center sm:py-28">
      {/* h-auto so the sm: width step scales the mark instead of squashing
          it — the width/height attributes stay on the SVG so it reserves
          its box before CSS lands and never shifts the heading. */}
      <HorizonMark width={220} className="h-auto w-[180px] sm:w-[220px]" />

      <h1 className="mt-10 font-display text-4xl text-lacquer sm:text-5xl">
        {t("notFound.title")}
      </h1>
      <p className="mt-4 leading-relaxed text-ink/75">{t("notFound.body")}</p>

      <div className="mt-9 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <Link
          href="/menu"
          className="token-colors inline-flex min-h-12 items-center justify-center rounded-lg bg-gold px-7 font-semibold text-ink hover:bg-gold-light"
        >
          {t("notFound.viewMenu")}
        </Link>
        <Link
          href="/"
          className="arrow-link token-colors inline-flex min-h-12 items-center justify-center rounded-lg border border-gold/60 px-7 font-semibold text-lacquer hover:border-gold hover:bg-gold/10"
        >
          {t("notFound.backHome")} <span className="arrow">→</span>
        </Link>
      </div>

      <p className="mt-8 text-sm text-ink/60">
        {t("notFound.orCall")}{" "}
        <PhoneLinks
          separator=" or "
          className="font-semibold text-lacquer underline underline-offset-2"
        />
      </p>
    </div>
  );
}
