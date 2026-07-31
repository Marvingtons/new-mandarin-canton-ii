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
      <ArcRule side="left" />
      {withKnot && !withSeal && (
        <KnotMark width={46} className="shrink-0 text-gold/70" />
      )}
      {withSeal && (
        <span data-divider-seal className="relative inline-flex shrink-0">
          <Seal size={34} tone="chop" />
          <span
            data-divider-ring
            className="pointer-events-none absolute inset-0 rounded-sm border border-lacquer opacity-0"
          />
        </span>
      )}
      <ArcRule side="right" />
    </div>
  );
}

/**
 * One half of the rule, as a shallow arc that crests where the ornament
 * sits — so the two halves and the chop between them read as a single
 * lifted eave rather than as two lines with a stamp dropped on top.
 *
 * Both curves are cubics with a HORIZONTAL TANGENT AT BOTH ENDS: flat as
 * they arrive under the ornament, flat again as they fade out at the
 * page edge. That is what stops a visible kink across the 20px gap on
 * either side of the seal, and it is the only reason a two-piece curve
 * can pass for one.
 *
 * Each path starts at its ORNAMENT end, which is also the end the
 * clip-path reveal opens from (see .gd-rule in globals.css and SCENE 7 in
 * HomeChoreography). The resting state carries no clip at all, so with no
 * JavaScript — or under reduced motion, where the motion context is never
 * built — the rule is simply already drawn.
 */
function ArcRule({ side }: { side: "left" | "right" }) {
  const left = side === "left";
  return (
    <svg
      data-divider-rule
      data-divider-side={side}
      className="gd-rule"
      viewBox="0 0 100 10"
      // The arc is a proportion of the box, not of the viewBox: stretched
      // to whatever width flex hands it and to the height the clamp sets.
      preserveAspectRatio="none"
      fill="none"
    >
      <path
        d={left ? "M100 2C70 2 45 9 0 9" : "M0 2C30 2 55 9 100 9"}
        stroke="currentColor"
        strokeWidth="1"
        // Without this the 1px stroke is stretched by the same non-uniform
        // scale as the geometry and thins to nothing along the flat runs.
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
