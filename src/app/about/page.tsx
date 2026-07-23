import type { Metadata } from "next";
import Established from "@/components/Established";
import SectionHeading from "@/components/SectionHeading";
import Seal from "@/components/Seal";

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

      <div className="mt-14 grid gap-6 sm:grid-cols-3">
        {photoSlots.map((caption) => (
          <figure key={caption}>
            <div className="flex aspect-[4/3] items-center justify-center border border-gold/50 bg-paper">
              <Seal size={52} className="opacity-35" />
              <span className="sr-only">Photo coming soon</span>
            </div>
            <figcaption className="mt-2 text-sm italic text-ink/60">
              {caption} — photo TODO
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
