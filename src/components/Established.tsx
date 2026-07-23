import { establishedLabel, tenureLine } from "@/data/restaurant";

interface EstablishedProps {
  /** Also print "30+ years on Telegraph Canyon" beneath the mark. */
  withTenure?: boolean;
  className?: string;
}

/**
 * The heritage mark: "Est. 1995" set in a gold hairline bracket that
 * echoes the 富源 seal's own frame — the same device at a whisper.
 * Quietly present, never loud; it is a trust asset, not a badge.
 *
 * Renders nothing when the founding year is unconfirmed, so this can be
 * dropped anywhere without risking an invented date.
 */
export default function Established({
  withTenure = false,
  className = "",
}: EstablishedProps) {
  if (!establishedLabel) return null;
  const tenure = withTenure ? tenureLine() : null;

  return (
    <span className={`inline-flex flex-col items-start gap-1 ${className}`}>
      <span className="inline-flex items-center gap-2 border-y border-gold/45 px-0.5 py-1 text-[0.6rem] uppercase tracking-[0.4em] text-gold">
        {establishedLabel}
      </span>
      {tenure && (
        <span className="text-[0.6rem] uppercase tracking-[0.18em] text-gold/60">
          {tenure}
        </span>
      )}
    </span>
  );
}
