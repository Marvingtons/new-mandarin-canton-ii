interface CraneMarkProps {
  /** Rendered width in px; height follows the mark's aspect. */
  width?: number;
  className?: string;
}

/**
 * 鶴 — the standing crane. Inlined verbatim from
 * `public/brand/motifs/crane-standing-mono.svg`, cut from the brand motif
 * sheet (`docs/brand/motifs-source.svg`, the source of truth).
 *
 * The crane is the character for a long life, which is the only reason it
 * is on the About page and nowhere else: that page is about a room that
 * outlived the people who opened it. Used anywhere else it would be
 * decoration.
 *
 * SINGLE-COLOUR ONLY — inherits `currentColor`. The full-colour original
 * (a white eye, a red crown) stays in the asset folder unused; at margin
 * size those two details turn to specks.
 */
export default function CraneMark({
  width = 66,
  className = "",
}: CraneMarkProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="7.45 61.85 15.9 25.14"
      width={width}
      height={(width * 25.14) / 15.9}
      fill="currentColor"
      className={className}
    >
      <path d="m19.7 62.1c-1 0.3-2.1 1.8-1.7 3 0.4 1.5 2.1 2.8 0.6 4-0.7-2-3.7-2.2-5.9 0l-4.3 4.8 1.7-0.8-1.9 2.3-0.5 1h0.3l3-2.3-1.3 1.9 2.5-2.1-1 1.7 1.8-0.6c1.1 0.4 0.7 0.6 0.9 1.1 0.5 1.9-1 2.3 0 3l2.5 2.3v4.7c0 0.6 2.2 0.8 2.2 0.5l-1-0.6 1 0.1-0.2-0.1 0.5-0.4h-2c-0.4-0.2 0-3.7-0.3-4l1.8 1.4v1.6c0.7-1.4 0.5-1.5 1.2-0.6l0.4 1.1v-1.2c-0.1-1.3-2.4-1.9-3.4-3v-3.3l0.3-0.2-0.5-0.4-0.2 0.5v-3.3l-1.8 2.9c-0.3 2 0.7 2.5 2 3.5v-4.7c0.5-0.3 1.8-1.8 1.2-2h-0.6c3.9-0.9 4.4-4 3.9-5.8l-1.9-3c-0.4-1.6 1-2 1.9-1.2l2.2 2.1-1.5-2.6-0.1-0.4-0.8-0.5-1-0.4z" />
      {/* the beak */}
      <path d="m19.7 62.2c0.7-0.3 1.8 0.3 1.9 1l-1-0.2-0.9-0.8z" />
    </svg>
  );
}
