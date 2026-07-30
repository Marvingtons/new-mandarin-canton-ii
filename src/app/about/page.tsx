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

      {/* Pull-quote opening line */}
      <blockquote className="mt-10 border-l-2 border-gold pl-6 font-display text-2xl italic leading-snug text-lacquer sm:text-3xl">
        TODO: the one line that captures this restaurant — in the family&apos;s
        own words.
      </blockquote>

      <div className="mt-9 space-y-5 leading-relaxed text-ink/80">
        <p>
          TODO: paragraph one — how the restaurant began, who started it, and
          when. (No dates until confirmed.)
        </p>
        <p>
          TODO: paragraph two — the room itself: the calligraphy on the walls,
          the gold Buddha, the altar with incense and fresh tangerines.
        </p>
        <p>
          TODO: paragraph three — the family today, and what stays the same no
          matter the year.
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
