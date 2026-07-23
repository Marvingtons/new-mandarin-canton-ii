/**
 * The site's section heading: display serif over a short gold rule.
 *
 * This used to pair every English heading with ghosted Chinese
 * calligraphy behind it. That device is gone by design — the guests
 * here read English, and half-translated UI reads as unfinished rather
 * than authentic. 富源 (the seal) is now the site's only Chinese, which
 * is what makes it land.
 *
 * HomeChoreography's heading reveal keys off [data-bh-text] and
 * .bh-rule, so those hooks are load-bearing — don't rename them
 * without updating that file.
 */
interface SectionHeadingProps {
  en: string;
  as?: "h1" | "h2";
  /** "light" for ivory/paper surfaces, "dark" for lacquer/ink surfaces. */
  tone?: "light" | "dark";
  align?: "left" | "center";
  /** Adds the staggered settle-on-load animation. */
  animated?: boolean;
  className?: string;
}

export default function SectionHeading({
  en,
  as = "h2",
  tone = "light",
  align = "left",
  animated = false,
  className = "",
}: SectionHeadingProps) {
  const Tag = as;
  const isH1 = as === "h1";

  const enSize = isH1 ? "text-4xl sm:text-5xl" : "text-3xl sm:text-4xl";
  const enTone = tone === "dark" ? "text-ivory" : "text-lacquer";

  return (
    <div
      className={`relative ${align === "center" ? "text-center" : "text-left"} ${className}`}
    >
      <Tag
        data-bh-text
        className={`relative font-display leading-tight ${enSize} ${enTone} ${animated ? "settle-2" : ""}`}
      >
        {en}
      </Tag>
      <span
        aria-hidden="true"
        className={`bh-rule mt-3 block h-px w-12 bg-gold ${align === "center" ? "mx-auto" : ""} ${animated ? "settle-2" : ""}`}
      />
    </div>
  );
}
