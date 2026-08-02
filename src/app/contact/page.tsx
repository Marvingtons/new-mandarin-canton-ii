import type { Metadata } from "next";
import SectionHeading from "@/components/SectionHeading";
import HoursTable from "@/components/HoursTable";
import LocationMap from "@/components/LocationMap";
import OpenNowChip from "@/components/OpenNowChip";
import PhotoFrame from "@/components/PhotoFrame";
import { photos } from "@/data/images";
import { phoneLinks, restaurant } from "@/data/restaurant";
import { getT } from "@/lib/i18n/server";
import FaqSection from "@/components/FaqSection";
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
          {/* Large tap targets — both lines are staffed */}
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
        </div>
      </div>

      <LocationMap aspect="16/7" tone="light" className="mt-14" />

      {/* THE FAQ LIVES HERE and not on its own page. Every answer is
          about visiting or ordering, which is this page's whole subject,
          and a one-question-per-page FAQ site is how a five-page
          restaurant site turns into thirty pages nobody links to. */}
      <FaqSection className="mt-16" />
    </div>
  );
}
