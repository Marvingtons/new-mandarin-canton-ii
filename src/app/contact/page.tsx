import type { Metadata } from "next";
import SectionHeading from "@/components/SectionHeading";
import HoursTable from "@/components/HoursTable";
import LocationMap from "@/components/LocationMap";
import OpenNowChip from "@/components/OpenNowChip";
import PhotoFrame from "@/components/PhotoFrame";
import { photos } from "@/data/images";
import { phoneLinks, restaurant, telHref } from "@/data/restaurant";
import { getT } from "@/lib/i18n/server";
import JsonLd from "@/components/JsonLd";
import { breadcrumbNode, graph } from "@/lib/schema";

export const metadata: Metadata = {
  title: "Contact",
  alternates: { canonical: "/contact" },
  /* 152 characters. This page had no description at all, so it silently
     inherited the homepage's — the same 154 characters about the whole
     restaurant served as the summary of the page that answers "where
     are they and when are they open". */
  description:
    "New Mandarin Canton II is at 543 Telegraph Canyon Rd, Chula Vista, open 7 days from 11 AM. Call (619) 656-6888 or (619) 656-6787 for takeout pickup.",
};

/**
 * ⚠️ THE HOURS TABLE AND THE OPEN/CLOSED CHIP ON THIS PAGE WERE ALREADY
 * TRANSLATED and everything around them was not, which made this the worst
 * mixed-language surface on the site: "Visit Us / FIND US / CALL / Takeout
 * orders welcome by phone. / HOURS" in English, wrapped around "Lunes …
 * SábadoHOY" and "ABIERTO · HASTA LAS 9:30 PM" in Spanish.
 *
 * The three section labels reuse footer.findUs / hero.call / footer.hours
 * rather than adding near-duplicate keys — same three words, same three
 * things, already translated for the footer.
 */
export default async function ContactPage() {
  const t = await getT();

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-8">
      <JsonLd
        data={graph(
          breadcrumbNode([
            { name: "Home", path: "/" },
            { name: "Contact", path: "/contact" },
          ]),
        )}
      />
      <SectionHeading as="h1" en={t("contact.title")} />

      {/* The three small-caps labels below are text-lacquer, not text-gold.
          The identical treatment in the Footer sits on bg-ink and measures
          7.76:1; here it sits on ivory and measured 2.02:1 — the same label,
          failing only on the light ground. Lacquer on ivory is 7.08:1 and is
          already this site's heading colour on a light page, so the label
          rejoins the scale rather than inventing a colour. */}
      <div className="mt-10 grid gap-12 md:grid-cols-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-lacquer">
            {t("footer.findUs")}
          </h2>
          <p className="mt-4 text-lg leading-relaxed">
            {restaurant.address.street}
            <br />
            {restaurant.address.city}, {restaurant.address.state}{" "}
            {restaurant.address.zip}
          </p>

          <h2 className="mt-9 text-xs font-semibold uppercase tracking-[0.25em] text-lacquer">
            {t("hero.call")}
          </h2>
          {/* Large tap targets. Two numbers with nothing said about them
              invites "so which one do I call?" — the answer, that both
              lines are staffed, was in the FAQ and is now in the line
              under them (contact.phoneWelcome). */}
          <div className="mt-4 flex flex-col gap-2 sm:items-start">
            {phoneLinks.map(({ phone, href }) => (
              <a
                key={phone}
                href={href}
                className="block rounded-lg bg-lacquer px-8 py-4 text-center font-display text-xl text-ivory transition-colors hover:bg-lacquer-dark sm:inline-block"
              >
                {t("contact.callNumber", { phone })}
              </a>
            ))}
          </div>
          <p className="mt-3 text-sm italic text-ink/60">
            {t("contact.phoneWelcome")}
          </p>

          {/* What to look for from the road. Its caption in the manifest is
              the street address, which is the whole reason it belongs on this
              page and not on the homepage. */}
          <PhotoFrame
            photo={photos.storefront}
            className="mt-9"
            parallaxAmp={0}
            sizes="(min-width: 768px) 45vw, 100vw"
          />
        </div>

        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-lacquer">
            {t("footer.hours")}
          </h2>
          <div className="mt-4">
            <HoursTable />
          </div>
          <OpenNowChip tone="light" className="mt-4" />
          <p className="mt-3 text-sm italic text-ink/60">
            {t("contact.open7")}
          </p>
          {/* The holiday caveat, second and last of its two homes (the
              other is the footer's hours column). Same line, same order,
              same 中文 — and the same reason for being here rather than on
              the menu page: it qualifies a set of hours, so it lives
              wherever the hours are printed.

              text-lacquer on the link, not gold: this page is ivory, where
              every gold in the palette measures ~2.1:1. Same rule as the
              small-caps labels above. */}
          <p className="mt-3 text-sm leading-relaxed text-ink/70">
            {t("hours.holidayLead")}{" "}
            <span aria-hidden="true" className="text-ink/35">
              ·
            </span>{" "}
            <a
              href={telHref}
              className="tap token-colors font-semibold text-lacquer underline decoration-gold/60 underline-offset-4 hover:text-lacquer-dark"
            >
              {t("hours.holidayCall")}
            </a>{" "}
            <span lang="zh-Hant" className="font-chinese text-ink/55">
              {t("hours.holidayZh")}
            </span>
          </p>
        </div>
      </div>

      {/* THE LAST THING ON THIS PAGE. It used to be followed by a FAQ
          whose eight answers each restated a fact already printed
          somewhere else — the menu banner, the checkout, the footer, the
          hours table, this page's own address block. Restating them here
          bought nothing but a second copy to keep in sync, so the map is
          where the page ends now. */}
      <LocationMap aspect="16/7" tone="light" className="mt-14" />
    </div>
  );
}
