interface KnotMarkProps {
  /** Rendered width in px; height follows the mark's aspect. */
  width?: number;
  className?: string;
}

/**
 * 盤長 — the endless knot: two interlaced loops with a small lozenge
 * above and below. Inlined verbatim from
 * `public/brand/motifs/knot-mono.svg`, which is cut from the brand motif
 * sheet (`docs/brand/motifs-source.svg`, the source of truth).
 *
 * A knot has no beginning and no end, which is why it earns the handoff
 * between the story and the food — it is the same claim the story makes.
 *
 * SINGLE-COLOUR ONLY. It inherits `currentColor`, so a placement tints it
 * from a token and the mark never carries a gold of its own. This is the
 * divider's quiet ornament, opposite the chop; see [[GoldDivider]] for
 * why there are exactly two.
 */
export default function KnotMark({
  width = 46,
  className = "",
}: KnotMarkProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="65.35 86.65 19.9 6.6"
      width={width}
      height={(width * 6.6) / 19.9}
      fill="currentColor"
      className={className}
    >
      {/* the lozenge above */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="m75.2 86.9 1 1.1-1.1 1.4-1.1-1.4 1.2-1.1z"
      />
      {/* the lozenge below */}
      <path d="m75.2 90.4 1 1.3-1.1 1.3-1.1-1.1 1.2-1.5z" />
      {/* right loop */}
      <path d="m75.9 89.9c0.7-0.5 2.3-2.8 4.1-1l-0.6 0.7c-0.4-0.7-1.8-0.2-2.3 0.4 1.8 1.7 2.9-1 5.3-1 1.5 0 2.3 0.6 2.6 1.4-0.6 1.3-3.6 2.2-4.3 0.7 1.2 0 1.9 0 2.7-0.7-1.8-1.7-3.2 1.6-5.5 1l-2-1z" />
      {/* left loop */}
      <path d="m74.5 89.9c-0.6-0.5-2.1-2.5-4-1l0.5 0.7c0.4-0.5 1.7-0.5 2 0.3-1.5 2-3-1-5.3-0.8-0.7 0.3-2.1 0.8-2.1 1.3 0.5 1.3 3.4 2.2 4.1 0.8-0.8-0.1-1.8 0.2-2.7-0.7 1.9-1.6 3.1 1.5 5.4 1l2.1-1.1v-0.5z" />
    </svg>
  );
}
