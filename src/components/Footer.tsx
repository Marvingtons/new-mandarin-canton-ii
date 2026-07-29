import Established from "@/components/Established";
import LocationMap from "@/components/LocationMap";
import OpenNowChip from "@/components/OpenNowChip";
import PhoneLinks from "@/components/PhoneLinks";
import Seal from "@/components/Seal";
import { restaurant } from "@/data/restaurant";
import type { DayOfWeek } from "@/data/restaurant";

const week: ReadonlyArray<readonly [DayOfWeek, string]> = [
  ["monday", "Mon"],
  ["tuesday", "Tue"],
  ["wednesday", "Wed"],
  ["thursday", "Thu"],
  ["friday", "Fri"],
  ["saturday", "Sat"],
  ["sunday", "Sun"],
];

export default function Footer() {
  return (
    <footer className="mt-auto border-t-4 border-double border-gold/60 bg-ink text-ivory">
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
          {/* The one heritage beat in the footer — sits with the seal,
              not with the copy, so the two read as one lockup. */}
          <Established withTenure className="mt-4" />
          <p className="mt-4 text-sm leading-relaxed text-ivory/70">
            {restaurant.tagline}
          </p>
        </div>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">
            Find Us
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ivory/85">
            {restaurant.address.street}
            <br />
            {restaurant.address.city}, {restaurant.address.state}{" "}
            {restaurant.address.zip}
          </p>
          <LocationMap className="mt-4" />
          <p className="mt-4 text-sm text-gold-light">
            <PhoneLinks
              separator=" · "
              className="transition-colors hover:text-gold"
            />
          </p>
        </div>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">
            Hours
          </h2>
          <ul className="mt-3 space-y-1 text-sm text-ivory/85">
            {week.map(([day, abbr]) => {
              const h = restaurant.hours[day];
              return (
                <li key={day} className="flex justify-between gap-4">
                  <span>{abbr}</span>
                  <span>{h.closed ? "Closed" : `${h.open} – ${h.close}`}</span>
                </li>
              );
            })}
          </ul>
          <OpenNowChip className="mt-4" />
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
