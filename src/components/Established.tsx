import { establishedLabel, tenureDecades, yearsOpen } from "@/data/restaurant";
import { getT } from "@/lib/i18n/server";

interface EstablishedProps {
  /** Also print the heritage line beneath the mark. */
  withTenure?: boolean;
  /**
   * Which ground it is standing on. This is not decoration — see the
   * contrast note below. Defaults to "dark" because the footer was its
   * first home.
   */
  ground?: "dark" | "light";
  className?: string;
}

/**
 * The heritage mark: "Est. YYYY" set in a gold hairline bracket that
 * echoes the 富源 seal's own frame — the same device at a whisper.
 * Quietly present, never loud; it is a trust asset, not a badge.
 *
 * While the founding year is unconfirmed there is no year to bracket, so
 * the heritage LINE carries the lockup on its own (see tenureLine). Either
 * way this can be dropped anywhere without risking an invented date.
 *
 * ONE COMPONENT, TWO GROUNDS, AND GOLD ONLY WORKS ON ONE OF THEM. This
 * renders in the footer (on --ink, where gold measures 7.75:1) and on the
 * About page (on --ivory, where the same gold measures 2.17:1 and fails
 * AA outright). It had one colour for both. Gold cannot be rescued by
 * picking a different gold — every gold in the palette lands within 0.05
 * of 2.17 on a light ground — so the light variant takes --lacquer at
 * 7.08:1, which is already this site's heading colour on a light page.
 * That rule was first written down in contact/page.tsx for exactly the
 * same label at exactly the same size; this is it applied where it was
 * missed.
 *
 * SERVER-ONLY, and async since the heritage line got its Spanish. Both
 * call sites (Footer, About) are async server components already, so
 * this costs nothing; a client component that needs it should render it
 * as a child rather than importing it.
 */
export default async function Established({
  withTenure = false,
  ground = "dark",
  className = "",
}: EstablishedProps) {
  const t = await getT();

  /* The three-way branch that used to be `tenureLine()`'s body. It reads
     out here rather than in the data file because each arm is now a
     dictionary key: the arithmetic is data, the sentence is copy. */
  const decades = tenureDecades();
  const tenure = !withTenure
    ? null
    : decades != null
      ? t("established.tenure", { decades })
      : yearsOpen() != null
        ? t("established.tenureShort")
        : t("established.tenureNoYear");

  if (!establishedLabel && !tenure) return null;
  const onLight = ground === "light";

  return (
    <span className={`inline-flex flex-col items-start gap-1 ${className}`}>
      {establishedLabel && (
        <span
          className={`inline-flex items-center gap-2 border-y px-0.5 py-1 text-xs uppercase tracking-[0.4em] ${
            onLight
              ? "border-lacquer/35 text-lacquer"
              : "border-gold/45 text-gold"
          }`}
        >
          {establishedLabel}
        </span>
      )}
      {tenure && (
        <span
          className={`text-xs uppercase tracking-[0.18em] ${
            onLight ? "text-lacquer/80" : "text-gold-light/70"
          }`}
        >
          {tenure}
        </span>
      )}
    </span>
  );
}
