import type { Metadata } from "next";
import Established from "@/components/Established";
import PhotoPlaceholder from "@/components/PhotoPlaceholder";
import SectionHeading from "@/components/SectionHeading";

export const metadata: Metadata = {
  title: "About",
};

// Photo slots — TODO: drop real photos in later. Each empty frame holds
// a ghosted seal, matching PhotoFrame's placeholder treatment.
const photoSlots: ReadonlyArray<string> = [
  "The dining room",
  "The family altar",
  "From the kitchen",
];

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

      <div className="mt-9 space-y-5 leading-relaxed text-ink/80">
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
          Come in and it still looks like itself: calligraphy on the walls, the
          altar by the door with incense and fresh tangerines. The same dishes
          are on the menu, at the same counter, seven days a week. That is
          most of what there is to tell — the rest is on the plate.
        </p>
      </div>

      {/* Same frame, same placeholder, same caption plate as the homepage
          frames — see .frame in globals.css. These used to be a one-off:
          a gold/50 border, no mount, a 35%-opacity seal, and an italic
          caption hanging outside the frame. */}
      <div className="mt-14 grid gap-6 sm:grid-cols-3">
        {photoSlots.map((caption) => (
          <figure key={caption} className="frame flex flex-col">
            <div className="relative aspect-[4/3] overflow-hidden">
              <PhotoPlaceholder sealSize={64} />
              <span className="sr-only">Photo coming soon</span>
            </div>
            <figcaption className="frame-rule frame-caption px-3 py-2.5 text-ink/60">
              {caption}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
