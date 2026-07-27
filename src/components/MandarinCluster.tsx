interface MandarinClusterProps {
  /** Rendered width in px; height follows the aspect. */
  width?: number;
  className?: string;
}

/**
 * Offerings for a prosperous year — the cluster of mandarins that sits
 * on the family altar, drawn in the same gold hairline as the single
 * [[MandarinMark]] so the two read as one motif at two scales.
 *
 * The third fruit carries [data-mandarin-settle]: HomeChoreography lets
 * it roll the last few degrees into place as the section arrives, the
 * way a fruit set down on a plate finds its own resting angle. Its
 * markup position IS its resting position, so with no JS the still life
 * is simply already composed.
 *
 * Inherits `currentColor`.
 */
export default function MandarinCluster({
  width = 190,
  className = "",
}: MandarinClusterProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 130 78"
      width={width}
      height={(width * 78) / 130}
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* back fruit, sitting deepest in the group */}
      <g>
        <circle cx="66" cy="30" r="18" />
        <path d="M66 12V9" />
      </g>

      {/* front-left, the largest — the one with the leaf */}
      <g>
        <circle cx="38" cy="47" r="23" />
        <path d="M38 24v-3.4" />
        <path d="M39.6 20.9c2.2-3.2 6.1-4 8.4-3.5.2 2.8-2 6.1-5.2 6.7-1.9.4-3.4-1.2-3.2-3.2z" />
      </g>

      {/* front-right — the one that settles into place on scroll. Its
          pivot is set by the tween via svgOrigin (user units), so no
          transform-box or transform-origin is needed here; if the
          circle below moves, update the origin in HomeChoreography. */}
      <g data-mandarin-settle>
        <circle cx="95" cy="50" r="19" />
        <path d="M95 31v-3" />
      </g>
    </svg>
  );
}
