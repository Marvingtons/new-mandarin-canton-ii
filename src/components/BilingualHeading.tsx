/**
 * The site's signature device: an English heading paired with its
 * Chinese characters, set large and ghosted in gold behind the English —
 * like calligraphy on the dining-room wall. Used on all four pages.
 */
interface BilingualHeadingProps {
  en: string;
  /** Traditional Chinese pairing, e.g. "菜單". Rendered as a decorative ghost. */
  zh?: string | null;
  as?: "h1" | "h2";
  /** "light" for ivory/paper surfaces, "dark" for lacquer/ink surfaces. */
  tone?: "light" | "dark";
  align?: "left" | "center";
  /** Adds the hero's staggered settle-on-load animation. */
  animated?: boolean;
  className?: string;
}

export default function BilingualHeading({
  en,
  zh,
  as = "h2",
  tone = "light",
  align = "left",
  animated = false,
  className = "",
}: BilingualHeadingProps) {
  const Tag = as;
  const isH1 = as === "h1";

  // Only reserve room for the ghost characters when there are any.
  const pad = zh ? (isH1 ? "pt-10 sm:pt-16" : "pt-8 sm:pt-10") : "";
  const zhSize = isH1 ? "text-6xl sm:text-8xl" : "text-5xl sm:text-6xl";
  const enSize = isH1 ? "text-4xl sm:text-5xl" : "text-3xl sm:text-4xl";
  const ghostTone = tone === "dark" ? "text-gold/25" : "text-gold/35";
  const enTone = tone === "dark" ? "text-ivory" : "text-lacquer";
  const ghostPos =
    align === "center" ? "left-1/2 -translate-x-1/2" : "-left-1 sm:-left-2";

  return (
    <div
      className={`relative ${pad} ${align === "center" ? "text-center" : "text-left"} ${className}`}
    >
      {zh && (
        <span
          aria-hidden="true"
          lang="zh-Hant"
          className={`pointer-events-none absolute top-0 select-none whitespace-nowrap font-chinese font-bold leading-none ${ghostPos} ${zhSize} ${ghostTone} ${animated ? "settle-1" : ""}`}
        >
          {zh}
        </span>
      )}
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
