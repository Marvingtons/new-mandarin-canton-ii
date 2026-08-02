import type { Metadata } from "next";
import Established from "@/components/Established";
import PhotoFrame from "@/components/PhotoFrame";
import SectionHeading from "@/components/SectionHeading";
import CraneMark from "@/components/motifs/CraneMark";
import { photos } from "@/data/images";
import { yearsOpen } from "@/data/restaurant";
import { translator } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/server";
import { spellYears, yearsInChinese } from "@/lib/years";

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

/**
 * THE FAMILY'S OWN WORDS, SIMPLIFIED — the source of truth, preserved
 * here verbatim and never rendered.
 *
 * What ships is the Traditional conversion in the dictionary
 * (`about.storyP*Zh`), because the rest of the site's 中文 is
 * Traditional: the seal, the dish names, the ticket, the notices. This
 * block is what a reviewer diffs that conversion against, and what the
 * family would recognise as the thing they wrote.
 *
 * 我们的餐厅创立于1995年。三十多年来，我们始终坚持一个信念：按照客人最喜爱的口味，
 * 用心烹制每一道菜，创造出属于我们自己的独一无二的美食风味。
 *
 * 从开业至今，我们已经走过了三十一年的岁月。许多客人小时候跟着父母来到这里用餐，
 * 如今长大成人、结婚成家，又带着自己的孩子回到我们的餐厅。能够陪伴一个家庭走过
 * 三代人的美好时光，是我们最大的荣幸，也是我们最珍惜的财富。
 *
 * 三十多年来，时代在变化，但我们对品质的坚持、对味道的执着、对每一位客人的用心
 * 从未改变。未来，我们也将继续秉持初心，坚持做好每一道菜、服务好每一位客人，
 * 让这份熟悉的味道和温暖一直传承下去。
 *
 * ⚠️ TODO(confirm): Traditional conversion pending family review.
 */

export default async function AboutPage() {
  /* Both the locale and the translator, rather than getT() alone: the
     story's year count has to be SPELLED in the reader's language
     ("thirty-one" / "treinta y un"), which is a decision only the locale
     can make. */
  const locale = await getLocale();
  const t = translator(locale);

  /* The count, computed from the founding year every render, so the
     sentence the family wrote in 2026 is still true in 2027. null only
     if the founding year is ever un-confirmed again, in which case the
     sentence that states a number drops and the paragraph still reads. */
  const years = yearsOpen();
  const spelled = years == null ? null : spellYears(years, locale);
  const yearsZh = years == null ? null : yearsInChinese(years);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-8">
      <SectionHeading as="h1" en={t("about.title")} />
      {/* ground="light": this page is ivory, where the footer's gold
          treatment measures 2.17:1. See Established. */}
      <Established withTenure ground="light" className="mt-5" />

      <blockquote className="mt-10 border-l-2 border-gold pl-6 font-display text-2xl italic leading-snug text-lacquer sm:text-3xl">
        {t("about.pullQuote")}
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

        {/* ⚠️ THE FAMILY'S HISTORY, IN THEIR WORDS. Supplied by them in
            Chinese with an approved English translation; see the block
            comment on the strings in lib/i18n/dictionary.ts before
            editing so much as a comma. The three paragraphs that used to
            sit here were drafted for them and are gone — except the
            memorial, which is below and flagged. */}
        <div className="space-y-5 leading-relaxed text-ink/80">
          <p>{t("about.storyP1")}</p>
          <p>
            {spelled && (
              <>
                {t("about.storyP2Lead", {
                  years: spelled.lower,
                  yearsCap: spelled.upper,
                })}{" "}
              </>
            )}
            {t("about.storyP2")}
          </p>
          <p>{t("about.storyP3")}</p>
        </div>

        {/* The same story in 中文, following its other half directly and
            set quieter — the pattern every bilingual notice on this site
            already uses ("Allergies? Call us first · 食物過敏請先致電"),
            at the length of a story rather than a line. It follows with
            no rule and no label between them because it is not a second
            section: it is the same three paragraphs, and the reader who
            needs it will find it by recognising it.

            No space joins the sentences inside the second paragraph —
            Chinese sets its own with 。 and a space would be a gap in the
            middle of a line.

            `leading-loose`: Noto Serif TC at this size needs more air
            between lines than Lora does, and a wall of 漢字 at
            leading-relaxed reads as a block rather than as paragraphs. */}
        <div
          lang="zh-Hant"
          className="mt-9 space-y-4 font-chinese leading-loose text-ink/60"
        >
          <p>{t("about.storyP1Zh")}</p>
          <p>
            {yearsZh && t("about.storyP2LeadZh", { years: yearsZh })}
            {t("about.storyP2Zh")}
          </p>
          <p>{t("about.storyP3Zh")}</p>
        </div>
      </div>

      {/* ⚠️ NOT PART OF THE FAMILY'S TEXT, and separated from it on
          purpose — the rule and the gap above are the whole point, so
          that nothing here reads as something they wrote.

          TODO(confirm): family to choose — story alone, or story +
          memorial section. Kept rather than deleted because it may well
          be true; theirs to decide, and the matching flag is on
          `about.memorial` in the dictionary. */}
      <div className="mt-12 border-t border-gold/30 pt-8">
        <p className="leading-relaxed text-ink/70">{t("about.memorial")}</p>
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
