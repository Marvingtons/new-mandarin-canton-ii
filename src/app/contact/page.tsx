import type { Metadata } from "next";
import SectionHeading from "@/components/SectionHeading";
import HoursTable from "@/components/HoursTable";
import LocationMap from "@/components/LocationMap";
import OpenNowChip from "@/components/OpenNowChip";
import PhotoFrame from "@/components/PhotoFrame";
import { photos } from "@/data/images";
import { phoneLinks, restaurant } from "@/data/restaurant";

export const metadata: Metadata = {
  title: "Contact",
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-8">
      <SectionHeading as="h1" en="Visit Us" />

      <div className="mt-10 grid gap-12 md:grid-cols-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">
            Find Us
          </h2>
          <p className="mt-4 text-lg leading-relaxed">
            {restaurant.address.street}
            <br />
            {restaurant.address.city}, {restaurant.address.state}{" "}
            {restaurant.address.zip}
          </p>

          <h2 className="mt-9 text-xs font-semibold uppercase tracking-[0.25em] text-gold">
            Call
          </h2>
          {/* Large tap targets — both lines are staffed */}
          <div className="mt-4 flex flex-col gap-2 sm:items-start">
            {phoneLinks.map(({ phone, href }) => (
              <a
                key={phone}
                href={href}
                className="block bg-lacquer px-8 py-4 text-center font-display text-xl text-ivory transition-colors hover:bg-lacquer-dark sm:inline-block"
              >
                Call {phone}
              </a>
            ))}
          </div>
          <p className="mt-3 text-sm italic text-ink/60">
            Takeout orders welcome by phone.
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
          <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">
            Hours
          </h2>
          <div className="mt-4">
            <HoursTable />
          </div>
          <OpenNowChip tone="light" className="mt-4" />
          <p className="mt-3 text-sm italic text-ink/60">
            Open 7 days a week.
          </p>
        </div>
      </div>

      <LocationMap aspect="16/7" tone="light" className="mt-14" />
    </div>
  );
}
