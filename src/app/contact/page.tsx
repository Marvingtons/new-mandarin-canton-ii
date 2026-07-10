import type { Metadata } from "next";
import BilingualHeading from "@/components/BilingualHeading";
import HoursTable from "@/components/HoursTable";
import { restaurant } from "@/data/restaurant";

export const metadata: Metadata = {
  title: "Contact",
};

export default function ContactPage() {
  const telHref = `tel:+1${restaurant.phone.replace(/\D/g, "")}`;
  const fullAddress = `${restaurant.address.street}, ${restaurant.address.city}, ${restaurant.address.state} ${restaurant.address.zip}`;
  const mapsQuery = encodeURIComponent(fullAddress);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-8">
      <BilingualHeading as="h1" en="Visit Us" zh="歡迎光臨" />

      <div className="mt-10 grid gap-12 md:grid-cols-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">
            Find Us{" "}
            <span lang="zh-Hant" className="font-chinese tracking-normal">
              地址
            </span>
          </h2>
          <p className="mt-4 text-lg leading-relaxed">
            {restaurant.address.street}
            <br />
            {restaurant.address.city}, {restaurant.address.state}{" "}
            {restaurant.address.zip}
          </p>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`}
            target="_blank"
            rel="noopener"
            className="mt-2 inline-block text-sm font-semibold text-lacquer underline decoration-gold underline-offset-4 transition-colors hover:text-lacquer-dark"
          >
            Get directions →
          </a>

          <h2 className="mt-9 text-xs font-semibold uppercase tracking-[0.25em] text-gold">
            Call{" "}
            <span lang="zh-Hant" className="font-chinese tracking-normal">
              電話
            </span>
          </h2>
          {/* Large tap target for phones */}
          <a
            href={telHref}
            className="mt-4 block bg-lacquer px-8 py-4 text-center font-display text-xl text-ivory transition-colors hover:bg-lacquer-dark sm:inline-block"
          >
            Call {restaurant.phone}
          </a>
          <p className="mt-3 text-sm italic text-ink/60">
            Takeout orders welcome by phone.
          </p>
        </div>

        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">
            Hours{" "}
            <span lang="zh-Hant" className="font-chinese tracking-normal">
              營業時間
            </span>
          </h2>
          <div className="mt-4">
            <HoursTable />
          </div>
          <p className="mt-3 text-sm italic text-ink/60">
            Open 7 days a week.
          </p>
        </div>
      </div>

      <div className="mt-14 aspect-[16/7] min-h-48 overflow-hidden border border-gold/50 bg-paper">
        <iframe
          title={`Map to ${restaurant.name}, ${fullAddress}`}
          src={`https://www.google.com/maps?q=${mapsQuery}&output=embed`}
          className="h-full w-full border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </div>
  );
}
