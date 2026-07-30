import Link from "next/link";
import SectionHeading from "@/components/SectionHeading";
import CandleGlow from "@/components/CandleGlow";
import FavoritesSpotlight from "@/components/FavoritesSpotlight";
import GoldCorners from "@/components/GoldCorners";
import GoldDivider from "@/components/GoldDivider";
import HeroVideo from "@/components/HeroVideo";
import HomeChoreography from "@/components/HomeChoreography";
import IncenseSmoke from "@/components/IncenseSmoke";
import MandarinCluster from "@/components/MandarinCluster";
import Parallax from "@/components/Parallax";
import PhotoFrame from "@/components/PhotoFrame";
import { photos } from "@/data/images";

/**
 * SECTION RHYTHM — cream → paper → cream → dark contact band → dark
 * footer, and nothing else. Every background here is a token; no section
 * leans on the body default. The contact band and footer are one unit and
 * live in Footer.tsx, so the pattern closes the same way on every page.
 *
 * Four sections used to sit in this file that no longer do: a trust strip
 * under the hero, a Kind Words review grid, a pinned lacquer statement
 * band, and a takeout phone strip. They were the reason the page read as
 * three sites — the lacquer band in particular was the only lacquer
 * surface on the page, a background value with no partner. Their code is
 * intact in git; HomeChoreography's statement-band scene (SCENE 4) is
 * still there too, guarded on a null lookup, so restoring the band is
 * putting the section back.
 */
export default function HomePage() {
  return (
    <>
      <HomeChoreography />
      <HeroVideo />

      {/* OUR STORY — first, and directly against the hero. A 30-year
          family room is the whole difference between this restaurant and a
          takeout box, so it is the first thing after the footage rather
          than something you find two thirds down.

          It stays SHORT here: four sentences and the link out. The full
          story belongs on /about.

          This is the page's one asymmetric moment — copy running wide on
          the left, the family frame hung offset on the right, dropping
          below the heading's baseline. Everything else on the page is a
          centred stack or an even grid, which is what lets this read as
          composed rather than as a mistake. */}
      <section className="bg-cream">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <div className="grid items-start gap-10 md:grid-cols-[3fr_2fr]">
            <div data-rise>
              <SectionHeading en="Our Story" />
              <p
                data-rise-item
                className="mt-7 max-w-xl leading-relaxed text-ink/80"
              >
                New Mandarin Canton II is a small, family-run room on
                Telegraph Canyon Road — calligraphy on the walls, an altar by
                the door with incense and fresh tangerines. Mandarin,
                Szechuan and Cantonese dishes, cooked the way they have
                always been. No reinvention. Just the food.
              </p>
              <p data-rise-item className="mt-6">
                <Link
                  href="/about"
                  className="arrow-link token-colors font-semibold text-lacquer underline decoration-gold underline-offset-4 hover:text-lacquer-dark"
                >
                  Read our story <span className="arrow">→</span>
                </Link>
              </p>
            </div>
            {/* The offset. Same frame and caption plate as The Room's
                photos, so the family reads as one of them. */}
            <Parallax className="md:mt-16">
              <PhotoFrame
                photo={photos.family}
                sizes="(min-width: 768px) 40vw, 100vw"
              />
            </Parallax>
          </div>
        </div>
      </section>

      {/* A drawn hairline hands off from the story to the dishes, with the
          mandarin as its quiet ornament */}
      <GoldDivider withMandarin />

      {/* House Favorites — spotlight grid (heading, link, and controls
          live in the component's left rail). overflow-hidden crops the
          rail ghost's left bleed so it never causes a scrollbar. */}
      <section className="overflow-hidden bg-paper">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <FavoritesSpotlight />
        </div>
      </section>

      {/* The Room — the altar, and the page's emotional heart. Three
          layers by depth: candle light and incense BEHIND the grid, the
          grid itself, then the offering of mandarins in FRONT of it. */}
      <section data-room className="relative overflow-hidden bg-cream py-16">
        {/* ambient, behind everything */}
        <CandleGlow intensity={0.3} x="24%" y="54%" spread="64%" />
        <IncenseSmoke count={3} intensity={0.5} on="light" />

        <div className="relative mx-auto max-w-5xl px-4">
          <SectionHeading en="The Room" />
          <p data-rise className="mt-6 max-w-xl leading-relaxed text-ink/70">
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

          {/* The heritage beat, inside a lattice-cornered plaque. The line
              used to end "…since 1995"; the year came out with the rest of
              the unsourced founding-date copy (see the TODO(confirm) in
              restaurant.ts). What is left is only what the room shows.

              The Est./tenure lockup that used to sit under it now appears
              once, in the footer. */}
          <div
            data-rise
            className="relative mx-auto mt-20 max-w-2xl px-8 text-center sm:mt-24"
          >
            <GoldCorners size={16} inset={-2} />
            <p
              data-rise-item
              className="font-display text-xl italic leading-relaxed text-ink/80 sm:text-2xl"
            >
              The altar by the door watches over the kitchen — oranges for
              fortune, incense for family.
            </p>
          </div>
        </div>

        {/* The offering, in front of the grid — cropped by the section's
            overflow so it reads as sitting at the edge of the frame.
            Hidden on small screens, where it would only be clutter. */}
        <MandarinCluster
          width={210}
          className="pointer-events-none absolute bottom-8 left-[-2%] hidden text-gold/40 lg:block"
        />
      </section>

      {/* The page's one chop: the rule draws out and the seal presses in
          where the halves meet, handing off to the dark contact band. This
          is the seal's sanctioned ornament use — the other is the
          placeholder watermark, and there is no third. */}
      <GoldDivider withSeal className="py-4" />
    </>
  );
}
