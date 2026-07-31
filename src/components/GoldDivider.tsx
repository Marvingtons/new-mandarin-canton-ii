import KnotMark from "@/components/motifs/KnotMark";
import Seal from "@/components/Seal";

interface GoldDividerProps {
  /**
   * Punctuate the rule with the red chop stamping in at its centre.
   * Budget: at most TWO of these on the whole page — the chop stops
   * being a signature the moment it becomes a pattern.
   */
  withSeal?: boolean;
  /**
   * Punctuate the rule with the endless knot instead — the quieter of
   * the two ornaments, for handing off between sections.
   */
  withKnot?: boolean;
  className?: string;
}

/**
 * A gold hairline that draws outward from the centre as it scrolls into
 * view, optionally with the 富源 chop pressing in where the two halves
 * meet. Animated by HomeChoreography via the data hooks below.
 *
 * TWO ORNAMENTS, AND THERE IS NO THIRD. The chop is the loud one and gets
 * the page's last handoff; the knot ([[KnotMark]], from the brand motif
 * sheet) is the quiet one. The quiet slot used to be [[MandarinMark]] —
 * the knot took it over rather than joining it, so the site still has
 * exactly two divider styles. Variety by rotation, not by addition; the
 * mandarin keeps its own home in [[MandarinCluster]] on the altar, where
 * it means something.
 *
 * The resting state (no JS, or reduced motion) is the finished rule —
 * drawn, ornament visible, nothing hidden.
 */
export default function GoldDivider({
  withSeal = false,
  withKnot = false,
  className = "",
}: GoldDividerProps) {
  return (
    <div
      aria-hidden="true"
      data-divider
      className={`mx-auto flex max-w-5xl items-center gap-5 px-4 ${className}`}
    >
      <span data-divider-rule className="gd-rule gd-rule-left" />
      {withKnot && !withSeal && (
        <KnotMark width={46} className="shrink-0 text-gold/70" />
      )}
      {withSeal && (
        <span data-divider-seal className="relative inline-flex shrink-0">
          <Seal size={34} tone="chop" />
          <span
            data-divider-ring
            className="pointer-events-none absolute inset-0 rounded-[3px] border border-lacquer opacity-0"
          />
        </span>
      )}
      <span data-divider-rule className="gd-rule gd-rule-right" />
    </div>
  );
}
