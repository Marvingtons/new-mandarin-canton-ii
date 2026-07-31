interface LegalSectionProps {
  /** English heading. Carries the accessible name. */
  en: string;
  /** Traditional Chinese heading, set quieter beside the English. */
  zh: string;
  children: React.ReactNode;
}

/**
 * One section of /privacy or /terms: a bilingual header over an English
 * body.
 *
 * BILINGUAL HERE, ENGLISH EVERYWHERE ELSE, and that is a rule rather
 * than an inconsistency. SectionHeading dropped its ghosted Chinese on
 * purpose — half-translated marketing reads as unfinished, and 富源 is
 * the site's one Chinese moment. But the ORDER FLOW is already bilingual
 * wherever the message is functional rather than decorative ("Please
 * verify your phone number first. · 請先驗證電話號碼。"), because a
 * customer who cannot read the English still has to be able to act. A
 * privacy policy and a set of terms are the same kind of text.
 *
 * The 中文 is `lang="zh-Hant"` and NOT aria-hidden: unlike the old ghost
 * headings it is not a decorative duplicate, it is a real translation of
 * the heading and a screen reader should be able to reach it.
 */
export default function LegalSection({ en, zh, children }: LegalSectionProps) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl text-lacquer">
        {en}{" "}
        <span
          lang="zh-Hant"
          className="font-chinese text-lg font-medium text-ink/45"
        >
          {zh}
        </span>
      </h2>
      <span aria-hidden="true" className="mt-2.5 block h-px w-12 bg-gold" />
      <div className="mt-4 space-y-4 leading-relaxed text-ink/80">
        {children}
      </div>
    </section>
  );
}
