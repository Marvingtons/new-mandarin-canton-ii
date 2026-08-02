/**
 * THE ARC — one definition, every consumer.
 *
 * The site curves its horizontal boundaries in one grammar: a shallow
 * cubic with a HORIZONTAL TANGENT AT BOTH ENDS, so a curve meets the page
 * edge flat and meets its mirror flat at the centre with no kink. Before
 * this module the grammar was real but the geometry was retyped at each
 * site, which is how three "same" arcs drift into three approximations.
 *
 * TWO SHAPES, NOT ONE, and the difference is load bearing:
 *
 *   HEM_D      a closed BOUNDARY between two fills. Deepest at the two
 *              page edges, nothing at the centre. Consumed by the hero's
 *              bottom edge (HeroVideo) and by the preloader's wipe
 *              (LoadingOverlay), which are the same edge at two moments —
 *              the curtain lifts along the line the hero will settle on.
 *
 *   RULE_D()   an open RULE, one half at a time, cresting where the
 *              divider's ornament sits. Consumed by GoldDivider's
 *              ArcRule.
 *
 * A boundary that must enclose an area and a 1px rule that must pass
 * under a seal cannot be the same path — one is closed and asymmetric
 * per side, the other is open and mirrored. They are the same LANGUAGE,
 * which is what this module makes checkable: both live here, both are
 * cubics with horizontal tangents at both ends, and a change to the
 * house curve is a change to this file.
 *
 * All paths are authored in a 100 x 10 box and stretched by
 * `preserveAspectRatio="none"`, so the arc is a proportion of whatever
 * width and height it is given rather than a fixed radius.
 */

/** The box every path here is authored in. */
export const ARC_VIEWBOX = "0 0 100 10";

/**
 * The hem: fill runs from the curve DOWN, deepest at x=0 and x=100,
 * zero at x=50. Two mirrored cubics, then closed along the bottom.
 *
 * Control points sit directly above/below their endpoints (25 0 / 25 10,
 * 75 10 / 75 0), which is what puts the tangent horizontal at the page
 * edge, at the centre, and therefore across the join.
 */
export const HEM_D =
  "M0 0C25 0 25 10 50 10C75 10 75 0 100 0L100 10L0 10Z";

/**
 * The same curve, filled on the OTHER side — a skirt that hangs lowest at
 * the centre and runs out to nothing at the page edges.
 *
 * This is what the preloader's curtain wears along its bottom edge, and
 * the side matters. HEM_D fills DOWNWARD, so in the hero it puts cream
 * deepest at the edges and leaves the dark footage reaching lowest at the
 * centre. A dark curtain lifting off that page has to reach lowest at the
 * centre too, or the two darks would meet along opposite profiles and the
 * curve would read as a wobble rather than as one edge. Same cubic, same
 * control points, same horizontal tangents; only the closing edge moves,
 * from y=10 to y=0.
 */
export const HEM_SKIRT_D = "M0 0C25 0 25 10 50 10C75 10 75 0 100 0Z";

/**
 * One half of a divider rule, from the ORNAMENT end outward — which is
 * also the end its clip-path reveal opens from (see .gd-rule).
 */
export function RULE_D(side: "left" | "right"): string {
  return side === "left" ? "M100 2C70 2 45 9 0 9" : "M0 2C30 2 55 9 100 9";
}
