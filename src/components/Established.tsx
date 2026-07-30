import { establishedLabel, tenureLine } from "@/data/restaurant";

interface EstablishedProps {
  /** Also print the heritage line beneath the mark. */
  withTenure?: boolean;
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
 */
export default function Established({
  withTenure = false,
  className = "",
}: EstablishedProps) {
  const tenure = withTenure ? tenureLine() : null;
  if (!establishedLabel && !tenure) return null;

  return (
    <span className={`inline-flex flex-col items-start gap-1 ${className}`}>
      {establishedLabel && (
        <span className="inline-flex items-center gap-2 border-y border-gold/45 px-0.5 py-1 text-xs uppercase tracking-[0.4em] text-gold">
          {establishedLabel}
        </span>
      )}
      {tenure && (
        <span className="text-xs uppercase tracking-[0.18em] text-gold-light/70">
          {tenure}
        </span>
      )}
    </span>
  );
}
