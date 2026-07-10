import Image from "next/image";
import Link from "next/link";
import BilingualHeading from "@/components/BilingualHeading";
import FavoritesSpotlight from "@/components/FavoritesSpotlight";
import HeroVideo from "@/components/HeroVideo";
import HomeChoreography from "@/components/HomeChoreography";
import OpenNowChip from "@/components/OpenNowChip";
import Parallax from "@/components/Parallax";
import PhotoFrame from "@/components/PhotoFrame";
import Seal from "@/components/Seal";
import { photos } from "@/data/images";
import { restaurant } from "@/data/restaurant";
import { reviews } from "@/data/reviews";

export default function HomePage() {
  const telHref = `tel:+1${restaurant.phone.replace(/\D/g, "")}`;

  return (
    <>
      <HomeChoreography />
      <HeroVideo />

      {/* House Favorites — spotlight grid (heading, link, and controls
          live in the component's left rail). overflow-hidden crops the
          rail ghost's left bleed so it never causes a scrollbar. */}
      <section className="overflow-hidden bg-paper">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <FavoritesSpotlight />
        </div>
      </section>

      {/* The Room — gallery band */}
      <section data-room className="mx-auto max-w-5xl px-4 py-16">
        <BilingualHeading en="The Room" zh="店裡" />
        <p className="mt-6 max-w-xl leading-relaxed text-ink/70">
          Come in — the room is part of the meal.
        </p>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          <PhotoFrame photo={photos.altar} />
          {/* offset + reversed curtain so the row feels composed */}
          <PhotoFrame
            photo={photos.diningRoom}
            revealDelay={120}
            direction="rtl"
            parallaxAmp={10}
            className="sm:translate-y-6"
          />
          <PhotoFrame photo={photos.buddha} revealDelay={240} />
        </div>
      </section>

      {/* Kind Words — the page's rest note, deliberately plain */}
      <section className="mx-auto max-w-5xl px-4 py-16">
        <BilingualHeading en="Kind Words" />
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {reviews.map((review) => (
            <figure
              key={review.id}
              className="kw-card border border-gold/30 bg-cream p-6"
            >
              <span
                aria-hidden="true"
                className="font-display text-4xl leading-none text-gold"
              >
                “
              </span>
              <blockquote className="mt-2 text-sm italic leading-relaxed text-ink/70">
                {review.quote}
              </blockquote>
              <div aria-hidden="true" className="kw-rule mt-4" />
              {review.attribution && (
                <figcaption className="mt-3 text-xs uppercase tracking-[0.15em] text-ink/50">
                  {review.attribution}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      </section>

      {/* Statement band — the page's register change; pinned on
          desktop by HomeChoreography, CSS two-beat entrance on mobile */}
      <section
        data-statement
        className="relative overflow-hidden bg-lacquer text-ivory"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundImage: "url('/bg-red.jpg')",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="relative mx-auto max-w-4xl px-4 py-24 text-center sm:py-32">
          {/* No scroll-reveal wrapper here — the pin sequence (desktop)
              / two-beat timeline (mobile) IS this band's entrance. */}
          <div data-st-lockup>
            <span
              lang="zh-Hant"
              className="st-eyebrow font-chinese text-base font-bold tracking-[0.5em] text-gold"
            >
              老味道
            </span>
            <div aria-hidden="true" className="st-rule" />
            <p className="st-line mt-5 font-display text-3xl leading-tight sm:text-5xl">
              Cooked the way it&apos;s always been.
            </p>
          </div>
        </div>
      </section>

      {/* About teaser */}
      <section className="mx-auto max-w-5xl px-4 py-16">
        <div className="grid items-center gap-10 md:grid-cols-[2fr_3fr]">
          <Parallax>
            <PhotoFrame
              photo={photos.family}
              sizes="(min-width: 768px) 40vw, 100vw"
            />
          </Parallax>
          <div>
            <BilingualHeading en="Our Story" zh="我們的故事" />
            <p className="mt-7 max-w-xl leading-relaxed text-ink/80">
              New Mandarin Canton II is a small, family-run room on Telegraph
              Canyon Road — calligraphy on the walls, an altar by the door
              with incense and fresh tangerines, and Mandarin, Szechuan &amp;
              Cantonese dishes cooked the way they have always been. No
              reinvention. Just the food.
            </p>
            <p className="mt-6">
              <Link
                href="/about"
                className="arrow-link token-colors font-semibold text-lacquer underline decoration-gold underline-offset-4 hover:text-lacquer-dark"
              >
                Read our story <span className="arrow">→</span>
              </Link>
            </p>
            {/* seal signature — stamps in with a closing ink-ring echo */}
            <div className="mt-8">
              <span data-seal-sig className="relative inline-block">
                <Seal size={40} />
                <span
                  data-seal-ring
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[2px] border-2 border-lacquer opacity-0"
                />
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Takeout strip */}
      {/* TODO: add DoorDash/Grubhub buttons if owners confirm */}
      <section className="border-y border-gold/30 bg-paper">
        <div
          data-plain-fade
          className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-5 text-xs uppercase tracking-[0.18em] text-ink/70"
        >
          <span>Call ahead</span>
          <span aria-hidden="true" className="text-gold">
            ·
          </span>
          <a
            href={telHref}
            className="font-semibold text-lacquer transition-colors hover:text-lacquer-dark"
          >
            {restaurant.phone}
          </a>
          <span aria-hidden="true" className="text-gold">
            ·
          </span>
          <span>Pick up on Telegraph Canyon Rd</span>
        </div>
      </section>

      {/* Info band, styled like a restaurant placard. When a storefront
          photo lands in the manifest it becomes the ambient background
          behind an ink overlay — no reveal animation here. */}
      <section className="relative overflow-hidden bg-ink text-ivory">
        {photos.storefront.src && (
          <>
            <Image
              src={photos.storefront.src}
              alt=""
              fill
              sizes="100vw"
              className="object-cover"
              aria-hidden="true"
            />
            <div aria-hidden="true" className="absolute inset-0 bg-ink/70" />
          </>
        )}
        <div className="relative mx-auto max-w-5xl px-4 py-12">
          <div
            data-plain-fade
            className="border border-gold/50 px-6 py-9 outline outline-offset-4 outline-gold/25 sm:px-10"
          >
            <div className="grid gap-8 text-center sm:grid-cols-3">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">
                  Hours{" "}
                  <span lang="zh-Hant" className="font-chinese tracking-normal">
                    營業時間
                  </span>
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-ivory/85">
                  Open 7 days · 11 AM to close
                </p>
                <div className="mt-3">
                  <OpenNowChip />
                </div>
                <Link
                  href="/contact"
                  className="arrow-link token-colors mt-2 block text-sm text-gold-light hover:text-gold"
                >
                  Full hours <span className="arrow">→</span>
                </Link>
              </div>
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">
                  Find Us{" "}
                  <span lang="zh-Hant" className="font-chinese tracking-normal">
                    地址
                  </span>
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-ivory/85">
                  {restaurant.address.street}
                  <br />
                  {restaurant.address.city}, {restaurant.address.state}{" "}
                  {restaurant.address.zip}
                </p>
              </div>
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">
                  Call{" "}
                  <span lang="zh-Hant" className="font-chinese tracking-normal">
                    電話
                  </span>
                </h2>
                <a
                  href={telHref}
                  className="mt-3 inline-block font-display text-lg text-gold-light transition-colors hover:text-gold"
                >
                  {restaurant.phone}
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
