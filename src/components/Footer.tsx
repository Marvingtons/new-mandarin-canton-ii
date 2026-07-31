import type { CSSProperties } from "react";
import Link from "next/link";
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
              Status and address read as one left-aligned block; the three
              things a guest can DO sit together as equal actions. On mobile
              the whole thing becomes one column — status, address, then
              three full-width tap targets. ---- */}
      <div className="border-b border-gold/25">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:py-12">
          {/* Padding goes on the inner element, never on .frame itself:
              .frame's own padding IS the mount, and being unlayered CSS it
              outranks a utility class — which is how this band ended up
              with its contents 2px from the edge. */}
          <div style={BAND_FILL} className="frame">
            <div className="flex flex-col gap-7 px-6 py-7 sm:flex-row sm:items-center sm:justify-between sm:gap-10 sm:px-9 sm:py-8">
              <div className="flex flex-col items-start gap-3">
                <OpenNowChip />
                <p className="text-sm leading-relaxed text-ivory/85">
                  {fullAddress}
                </p>
              </div>
              {/* Equal columns, so the two numbers and the directions link
                  read as one set of actions rather than two boxes and an
                  afterthought. */}
              <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-3 sm:gap-4">
                {phoneLinks.map(({ phone, href }) => (
                  <a
                    key={phone}
                    href={href}
                    className="token-colors inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-lg border border-gold/60 px-6 py-3 font-display text-lg text-gold-light hover:border-gold hover:bg-gold hover:text-ink"
                  >
                    {phone}
                  </a>
                ))}
                <a
                  href={directionsUrl}
                  target="_blank"
                  rel="noopener"
                  className="arrow-link token-colors inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-lg border border-gold/60 px-6 py-3 text-sm font-semibold text-gold-light hover:border-gold hover:bg-gold hover:text-ink"
                >
                  Get Directions <span className="arrow">→</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---- FOOTER: brand, the per-day table, the map ---- */}
      <div className="mx-auto grid max-w-5xl gap-x-16 gap-y-12 px-4 py-14 sm:grid-cols-3">
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
              read as a single lockup. Year and tenure both come from
              restaurant.features.foundingYear. */}
          <Established withTenure className="mt-5" />
          <p className="mt-5 max-w-xs text-sm leading-relaxed text-ivory/70">
            {restaurant.tagline}
          </p>
        </div>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">
            Hours
          </h2>
          {/* Summary and table are the same data at two resolutions, which
              is worth keeping — but the table is the answer, so the line
              above it is set quieter than the rows it introduces. */}
          <p className="mt-3 text-xs leading-relaxed text-ivory/50">
            {weeklyOpeningSummary}
          </p>
          <HoursTable tone="dark" dense className="mt-4" />
        </div>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">
            Find Us
          </h2>
          {/* Directions off: the band above carries that link, and is the
              tappable copy of the address. This one is context for the map,
              so it sits with it — clear of the frame's edge. */}
          <LocationMap showDirections={false} className="mt-3 max-w-sm" />
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-ivory/60">
            {fullAddress}
          </p>
        </div>
      </div>

      <div className="border-t border-ivory/10 px-4 py-7 text-center text-xs leading-relaxed text-ivory/50">
        {/* Stated sitewide: we never deliver, and a customer should never have
            to reach the cart to find that out.
            English only, deliberately. The customer-facing site carries no
            functional 中文 — 富源 is its one Chinese moment — so a 自取 here
            would be the first half-translated label on the page. The kitchen
            ticket, which IS Chinese-primary, already prints 取餐. */}
        <p className="text-ivory/60">
          Takeout pickup only · no delivery · Questions about allergies? Call
          us.
        </p>
        <p className="mt-2.5">
          © {new Date().getFullYear()} {restaurant.name}
        </p>
        {/* Legal and credit on one line, at the same weight as each other.
            Muted on purpose: these have to be FINDABLE, not prominent —
            somebody deciding whether to hand over a phone number needs to
            be able to reach the privacy page without hunting, and nobody
            else should have to look at it. */}
        <p className="mt-2.5 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1">
          <Link
            href="/privacy"
            className="text-ivory/40 transition-colors hover:text-ivory/60"
          >
            Privacy
          </Link>
          <span aria-hidden="true" className="text-ivory/25">
            ·
          </span>
          <Link
            href="/terms"
            className="text-ivory/40 transition-colors hover:text-ivory/60"
          >
            Terms
          </Link>
          <span aria-hidden="true" className="text-ivory/25">
            ·
          </span>
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
