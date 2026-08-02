"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/LocaleContext";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  type Locale,
} from "@/lib/i18n/locale";

/**
 * EN / ES, in the header — a SEGMENTED PILL, not two more nav links.
 *
 * Two buttons rather than a select or a globe icon: there are exactly two
 * languages, both fit, and a customer should be able to see which one is
 * active without opening anything. The inactive one is the tap target;
 * the active one is a state, marked `aria-current` and not clickable.
 *
 * IT USED TO READ AS ITEMS FIVE AND SIX OF THE NAV. Measured on /about at
 * 1440, the four links sat 24px apart and the toggle sat 24px after
 * CONTACT — the same interval — set in the same uppercase tracking, with
 * only a 2px type-size difference and a hairline `|` between the halves.
 * Nothing about that says "control" rather than "destination".
 *
 * Three things separate it now, and none of them is a new colour:
 *   SHAPE     one --radius-full track with the active half filled. A
 *             filled segment is not a link; nothing else in the nav has
 *             a background at all.
 *   INTERVAL  the gap to CONTACT is widened in Header.tsx to 40px against
 *             the nav's own 24px, so the pill sits outside the rhythm
 *             instead of extending it.
 *   SIZE      11px against the links' 14px.
 *
 * One treatment serves both header states rather than two: the track is
 * ink at 30% with a gold hairline, which is legible on the solid lacquer
 * and over the footage alike, and the active half is a gold fill with ink
 * on it — the same gold/ink pairing as the hero's primary CTA.
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
 * the nav at every size, in the same order, and the pill needs no
 * separate small-screen variant.
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
      className={`lang-pill inline-flex items-center rounded-full border border-gold/40 bg-ink/30 p-0.5 text-[11px] uppercase tracking-[0.12em] ${className}`}
      role="group"
      aria-label={t("lang.label")}
    >
      {(["en", "es"] as const).map((code) => {
        const active = locale === code;
        return (
          <button
            key={code}
            type="button"
            onClick={() => choose(code)}
            aria-current={active ? "true" : undefined}
            // The active one is not a control. Announcing a button that
            // does nothing is how a screen reader user ends up tapping
            // it to find out.
            disabled={active}
            lang={code}
            // The filled half is the whole point of the shape, so it
            // carries the weight; the empty half stays a label until you
            // reach for it. Measured on the track this now sits on —
            // ink/30 over lacquer, and ink/30 over the footage's brightest
            // header frame:
            //   ink on gold (active)        7.76
            //   ivory/85, solid lacquer     7.22
            //   ivory/85, over the hero     4.78
            // The track is why the inactive half improved: it was 5.6 on
            // bare lacquer before, because there was nothing under it.
            // `tap` on the INACTIVE half only, and that is what makes it
            // safe: the halves are flush against each other, so a 44px
            // target around each would have them overlapping by 12px and
            // the wrong language would win in the middle. The active half
            // is `disabled` — it has no target to steal — so exactly one
            // of the two ever carries this, and it may grow into its
            // neighbour freely. Measured 32x15 at 390 before.
            //
            // tap-LEFT because this pill is the last thing on the header
            // row: centred, the target reached 376.9px in a 375px viewport
            // and put a 2px horizontal scroll on every page of the site.
            // Growing leftward is also the direction with room in it —
            // into the disabled half when EN is active, into the 36px gap
            // after CONTACT when ES is.
            className={`rounded-full px-2 py-0.5 leading-none ${
              active
                ? "bg-gold font-semibold text-ink"
                : "tap tap-left token-colors text-ivory/85 hover:bg-ivory/10 hover:text-gold-light"
            }`}
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
        );
      })}
    </div>
  );
}
