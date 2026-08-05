import type { CSSProperties } from "react";
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
import { HERO_MEDIA_ORIGIN, HERO_POSTER } from "@/lib/heroMedia";
import { getT } from "@/lib/i18n/server";

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
export default async function HomePage() {
  const t = await getT();

  return (
    <>
      {/* ---- THE TWO HINTS THE HOMEPAGE NEEDS, HOISTED INTO <head> ----

          React hoists <link> out of the tree and into the document head,
          so these are plain elements rather than a ReactDOM.preload()
          call in a client component. That was the first attempt and it
          silently emitted NOTHING — the head came back with Next's own
          script preload and no image hint at all. These are verifiable
          in `curl | grep '<link'`, which is the only reason to prefer
          one spelling of a head tag over another.

          1. THE POSTER, AT HIGH PRIORITY. /hero-poster-plate.jpg IS this
          site's Largest Contentful Paint element — Lighthouse names the
          node (div.hero-kenburns) and its discovery checklist failed on
          exactly one line: `priorityHinted: false`. The poster is a CSS
          background-image, so there is no <img> to put `priority` on and
          no `fetchpriority` attribute available; this link is the only
          way to tell the browser it outranks the rest of the page. It
          also moves the request into the FIRST network flight, because
          the preload scanner reads the head before the CSSOM exists.

          2. THE MEDIA ORIGIN. The footage moved to its own hostname for
          cache headers (see lib/heroMedia.ts) and that costs a DNS + TCP
          + TLS handshake the old same-origin request never paid. Without
          this the handshake waits for the <video> to mount. No
          crossOrigin: the video is a plain no-cors media request, and a
          preconnect whose CORS mode does not match opens a connection
          the browser then refuses to reuse. */}
      <link
        rel="preload"
        as="image"
        href={HERO_POSTER}
        fetchPriority="high"
      />
      <link rel="preconnect" href={HERO_MEDIA_ORIGIN} />
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
              <SectionHeading en={t("home.storyTitle")} />
              {/* THE SIGNATURE LINE, first of its two sanctioned homes
                  (the other is the About pull-quote). It sits between
                  the heading and the prose as a pull-line, in the same
                  Playfair italic the About blockquote and the altar
                  plaque use, so the site's three "said out loud" moments
                  are one voice set three times rather than three
                  treatments. See story.threeGenerations for why there is
                  no third placement. */}
              <p
                data-rise-item
                className="mt-6 max-w-xl font-display text-2xl italic leading-snug text-lacquer sm:text-[1.75rem]"
              >
                {t("story.threeGenerations")}
              </p>
              <p
                data-rise-item
                className="mt-5 max-w-xl leading-relaxed text-ink/80"
              >
                {t("home.storyBody")}
              </p>
              <p data-rise-item className="mt-6">
                <Link
                  href="/about"
                  className="arrow-link token-colors font-semibold text-lacquer underline decoration-gold underline-offset-4 hover:text-lacquer-dark"
                >
                  {t("home.readOurStory")} <span className="arrow">→</span>
                </Link>
              </p>
            </div>
            {/* The offset. Same frame and caption plate as The Room's
                photos, so the family reads as one of them — and now it is
                the ink illustration that hangs here rather than a
                placeholder.

                THREE THINGS THE ILLUSTRATION NEEDS THAT A PHOTOGRAPH DOES
                NOT, all of them about not cropping composed artwork:

                --frame-fill is the artwork's OWN paper, #FCEFDC, measured
                off the file. The mount would otherwise be --cream
                (#FCF7EC) and the artwork is 8 levels down in green and 16
                in blue from it — enough to read as a tone step where the
                sheet meets the mount. Colouring the mount to the artwork
                keeps the illustration on its own paper inside the gold
                edge; recolouring the artwork to the site was the other
                option and is the wrong one.

                parallaxAmp 0 because a drawing that slides against its
                frame reads as a mistake, and because the overhang the
                slide needs would crop it (see PhotoFrame).

                `aspect` is left to the manifest's 4/3 — its own shape. */}
            <Parallax className="md:mt-16">
              <PhotoFrame
                photo={photos.family}
                parallaxAmp={0}
                style={{ "--frame-fill": "#FCEFDC" } as CSSProperties}
                sizes="(min-width: 768px) 40vw, 100vw"
              />
            </Parallax>
          </div>
        </div>
      </section>

      {/* A drawn hairline hands off from the story to the dishes, with the
          endless knot as its quiet ornament — no beginning and no end,
          which is the story's own claim */}
      <GoldDivider withKnot />

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
          <SectionHeading en={t("home.roomTitle")} />
          <p data-rise className="mt-6 max-w-xl leading-relaxed text-ink/70">
            {t("home.roomIntro")}
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
              used to end "…since 1995" and does not any more, but no
              longer because the year was unsourced — it is confirmed now,
              in the family's own history. It stays out because this
              plaque is about what the room shows, and the year has one
              home: the Est./tenure lockup in the footer. */}
          <div
            data-rise
            className="relative mx-auto mt-20 max-w-2xl px-8 text-center sm:mt-24"
          >
            <GoldCorners size={16} inset={-2} />
            <p
              data-rise-item
              className="font-display text-xl italic leading-relaxed text-ink/80 sm:text-2xl"
            >
              {t("home.altar")}
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
