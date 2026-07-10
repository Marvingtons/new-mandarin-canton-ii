import type { Metadata } from "next";
import BilingualHeading from "@/components/BilingualHeading";

export const metadata: Metadata = {
  title: "About",
};

// Photo slots — TODO: drop real photos in later. The ghost glyph gives
// each frame a hint of its subject (堂 hall, 香 incense, 廚 kitchen).
const photoSlots: ReadonlyArray<{ caption: string; glyph: string }> = [
  { caption: "The dining room", glyph: "堂" },
  { caption: "The family altar", glyph: "香" },
  { caption: "From the kitchen", glyph: "廚" },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-8">
      <BilingualHeading as="h1" en="About Us" zh="關於我們" />

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
        {photoSlots.map(({ caption, glyph }) => (
          <figure key={caption}>
            <div className="flex aspect-[4/3] items-center justify-center border border-gold/50 bg-paper">
              <span
                aria-hidden="true"
                lang="zh-Hant"
                className="select-none font-chinese text-5xl text-gold/40"
              >
                {glyph}
              </span>
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
