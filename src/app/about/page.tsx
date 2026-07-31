import type { Metadata } from "next";
import Established from "@/components/Established";
import PhotoFrame from "@/components/PhotoFrame";
import SectionHeading from "@/components/SectionHeading";
import CraneMark from "@/components/motifs/CraneMark";
import { photos } from "@/data/images";

export const metadata: Metadata = {
  title: "About",
};

/**
 * The three frames under the story.
 *
 * Driven by the shared manifest now rather than by three hard-coded captions
 * with a placeholder inside each. That is what lets a photo appear here by
 * setting one `src` in data/images.ts, and it is also the only way these stay
 * identical to the homepage frames — which the comment below has been claiming
 * since before they actually were.
 *
 * Landscape here, portrait on the homepage: same photographs, cropped to suit
 * a three-up row on a narrower page. `aspect` is the override that allows it.
 */
const photoSlots = [photos.diningRoom, photos.altar, photos.kitchen] as const;

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-8">
      <SectionHeading as="h1" en="About Us" />
      <Established withTenure className="mt-5" />

      {/* Pull-quote opening line — drawn from the story below, not from
          any quoted speech. Nobody here is putting words in the family's
          mouth. */}
      <blockquote className="mt-10 border-l-2 border-gold pl-6 font-display text-2xl italic leading-snug text-lacquer sm:text-3xl">
        The people have changed. The cooking hasn&apos;t.
      </blockquote>

      {/* The crane stands in the left margin beside the story, and it is the
          only motif on this page. 鶴 is the character for a long life, and
          this is the page about a room that outlived the people who opened
          it — so it is saying the same thing the paragraphs are, which is
          the whole test for whether it earns the space.

          Single colour, gold at 30%, and outside the reading column
          entirely: it is an accent in the margin, not an illustration in
          the text. `right-full` hangs it off the column's left edge and
          `absolute` keeps it out of flow, so it cannot shift a line of
          copy. Gated at xl (1280px), where the max-w-3xl column leaves
          256px of gutter each side and a 66px mark plus its 40px offset
          cannot reach the viewport edge — no horizontal scroll. */}
      <div className="relative mt-9">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-full top-1 mr-10 hidden xl:block"
        >
          <CraneMark width={66} className="text-gold/30" />
        </div>
        <div className="space-y-5 leading-relaxed text-ink/80">
          {/* The year is the same fact as restaurant.features.foundingYear,
              which sets the Est. mark above — keep the two in step. */}
          <p>
            New Mandarin Canton II opened on Telegraph Canyon Road in 1995. It
            was a family restaurant then and it is a family restaurant now —
            Mandarin, Szechuan and Cantonese dishes, cooked to order, in a room
            the family runs themselves.
          </p>
          {/* Second sentence below is the memorial line.
              TODO(confirm): family to approve this wording before launch */}
          <p>
            A restaurant open this long outlives some of the people who built
            it. When one of the original owners passed away, someone who had
            worked here since the early days became an owner and kept it open.
            The kitchen carried on as it was.
          </p>
          <p>
            Come in and it still looks like itself: calligraphy on the walls,
            the altar by the door with incense and fresh tangerines. The same
            dishes are on the menu, at the same counter, seven days a week.
            That is most of what there is to tell — the rest is on the plate.
          </p>
        </div>
      </div>

      {/* Same frame, same placeholder, same caption plate as the homepage
          frames — see .frame in globals.css. These used to be a one-off:
          a gold/50 border, no mount, a 35%-opacity seal, and an italic
          caption hanging outside the frame. */}
      <div className="mt-14 grid gap-6 sm:grid-cols-3">
        {photoSlots.map((photo, i) => (
          <PhotoFrame
            key={photo.id}
            photo={photo}
            aspect="4/3"
            revealDelay={i * 120}
            direction={i % 2 === 1 ? "rtl" : "ltr"}
            sizes="(min-width: 640px) 33vw, 100vw"
          />
        ))}
      </div>
    </div>
  );
}
