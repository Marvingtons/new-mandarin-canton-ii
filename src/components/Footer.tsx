import type { CSSProperties } from "react";
import Established from "@/components/Established";
import HoursTable from "@/components/HoursTable";
import LocationMap from "@/components/LocationMap";
import OpenNowChip from "@/components/OpenNowChip";
import Seal from "@/components/Seal";
import {
  directionsUrl,
  fullAddress,
  phoneLinks,
  restaurant,
  weeklyOpeningSummary,
} from "@/data/restaurant";

/** The band frames text, not a photo, so its mount stays transparent. */
const BAND_FILL = { "--frame-fill": "transparent" } as CSSProperties;

/**
 * The whole bottom of the site: one contact band, then one footer.
 *
 * It used to be three passes at the same information. A gold-boxed
 * HOURS / FIND US / CALL band on the homepage, then this footer repeating
 * FIND US and HOURS with the map, then a third phone list inside the
 * takeout strip just above — both numbers, the address, and an open/closed
 * pill all visible three times in one viewport. Now the band is the call
 * to action and the footer carries only what the band doesn't.
 *
 * The band lives here rather than on the homepage so the page ends the
 * same way everywhere, and so the status pill has exactly one home.
 */
export default function Footer() {
  return (
    <footer className="mt-auto border-t-4 border-double border-gold/60 bg-ink text-ivory">
      {/* ---- CONTACT BAND: status, address, both numbers, directions.
              One row on desktop; stacks on mobile with the numbers as the
              biggest tap targets on the screen. ---- */}
      <div className="border-b border-gold/25">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div
            style={BAND_FILL}
            className="frame flex flex-col items-center gap-5 px-5 py-5 text-center sm:flex-row sm:justify-between sm:gap-8 sm:px-7 sm:text-left"
          >
            <div className="flex flex-col items-center gap-2.5 sm:items-start">
              <OpenNowChip />
              <p className="text-sm leading-relaxed text-ivory/85">
                {fullAddress}
              </p>
            </div>
            <div className="flex w-full flex-col items-stretch gap-2.5 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
              {phoneLinks.map(({ phone, href }) => (
                <a
                  key={phone}
                  href={href}
                  className="token-colors inline-flex min-h-12 items-center justify-center border border-gold/60 px-6 py-3 font-display text-lg text-gold-light hover:border-gold hover:bg-gold hover:text-ink"
                >
                  {phone}
                </a>
              ))}
              <a
                href={directionsUrl}
                target="_blank"
                rel="noopener"
                className="arrow-link token-colors inline-flex min-h-12 items-center justify-center whitespace-nowrap text-sm font-semibold text-gold-light underline decoration-gold/60 underline-offset-4 hover:text-gold"
              >
                Get Directions <span className="arrow">→</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* ---- FOOTER: brand, the per-day table, the map ---- */}
      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 sm:grid-cols-3">
        <div>
          <Seal size={44} />
          <p className="mt-3 font-display text-xl">{restaurant.name}</p>
          {restaurant.chineseName && (
            <p
              lang="zh-Hant"
              className="mt-1 font-chinese text-sm tracking-[0.35em] text-gold-light"
            >
              {restaurant.chineseName}
            </p>
          )}
          {/* The site's ONE heritage beat, sitting with the seal so the two
              read as a single lockup. No year while the founding date is
              unconfirmed — see the TODO(confirm) in restaurant.ts. */}
          <Established withTenure className="mt-4" />
          <p className="mt-4 text-sm leading-relaxed text-ivory/70">
            {restaurant.tagline}
          </p>
        </div>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">
            Hours
          </h2>
          {/* Derived from restaurant.hours, like the table under it. The
              line here used to read "Open 7 days · 11 AM to close" while
              the table said 9:00, 9:30 and 8:30 depending on the day. */}
          <p className="mt-3 text-sm text-ivory/70">{weeklyOpeningSummary}</p>
          <HoursTable tone="dark" dense className="mt-3" />
        </div>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">
            Find Us
          </h2>
          {/* Directions off: the band above carries that link. */}
          <LocationMap showDirections={false} className="mt-3" />
        </div>
      </div>

      <div className="border-t border-ivory/10 py-4 text-center text-xs text-ivory/50">
        {/* Stated sitewide: we never deliver, and a customer should never have
            to reach the cart to find that out.
            English only, deliberately. The customer-facing site carries no
            functional 中文 — 富源 is its one Chinese moment — so a 自取 here
            would be the first half-translated label on the page. The kitchen
            ticket, which IS Chinese-primary, already prints 取餐. */}
        <p className="text-ivory/60">Takeout pickup only · no delivery</p>
        <p className="mt-2">
          © {new Date().getFullYear()} {restaurant.name}
        </p>
        <p className="mt-1">
          <a
            href="https://norvix.ai"
            target="_blank"
            rel="noopener"
            className="text-ivory/40 transition-colors hover:text-ivory/60"
          >
            Website by Norvix
          </a>
        </p>
      </div>
    </footer>
  );
}
