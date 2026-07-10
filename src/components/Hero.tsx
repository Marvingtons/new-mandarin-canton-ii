import Link from "next/link";
import BilingualHeading from "@/components/BilingualHeading";
import { restaurant } from "@/data/restaurant";

export default function Hero() {
  const telHref = `tel:+1${restaurant.phone.replace(/\D/g, "")}`;

  return (
    <section className="lacquer-vignette relative overflow-hidden text-ivory">
      {/* Thin gold inset frame, like a lacquered placard */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-3 border border-gold/40 sm:inset-4"
      />
      <div className="relative mx-auto max-w-3xl px-6 py-16 text-center sm:py-24">
        <BilingualHeading
          as="h1"
          en={restaurant.name}
          zh={restaurant.chineseName}
          tone="dark"
          align="center"
          animated
        />
        <p className="settle-3 mx-auto mt-6 max-w-xl text-lg leading-relaxed text-ivory/85">
          Old-school Cantonese &amp; Mandarin cooking, made the family way in
          Chula Vista.
        </p>
        <div className="settle-4 mt-9 flex flex-wrap justify-center gap-4">
          <Link
            href="/menu"
            className="bg-gold px-7 py-3 font-semibold text-ink transition-colors hover:bg-gold-light"
          >
            View Menu
          </Link>
          <a
            href={telHref}
            className="border border-ivory/60 px-7 py-3 font-semibold text-ivory transition-colors hover:border-gold-light hover:text-gold-light"
          >
            Call to Order
          </a>
        </div>
      </div>
    </section>
  );
}
