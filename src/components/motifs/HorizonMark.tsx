interface HorizonMarkProps {
  /** Rendered width in px; height follows the mark's aspect. */
  width?: number;
  className?: string;
}

/**
 * 山水 — a range of hills, the sun sitting on them, water running under.
 * Inlined from `public/brand/motifs/mountains-sun.svg`, cut from the brand
 * motif sheet (`docs/brand/motifs-source.svg`, the source of truth).
 *
 * The ONE full-colour placement on the site, and it sits on the 404 —
 * a horizon is the right picture for having walked off the edge of the
 * map, and an error page is the one place a picture is the whole content.
 *
 * RETONED. The sheet draws this in its own navy (#25333E), vermillion
 * (#CC4B3A) and gold (#C59850) — close to the site's palette but not it;
 * that navy in particular is a cool blue-grey where --ink is a warm
 * brown-black. Rather than let a fourth, fifth and sixth colour in through
 * an illustration, the three tones map onto the three tokens they stand
 * for. DESIGN.md's rule holds: colours change in globals.css only.
 */
export default function HorizonMark({
  width = 220,
  className = "",
}: HorizonMarkProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="47.95 64.95 53.7 17.56"
      width={width}
      height={(width * 17.56) / 53.7}
      fill="none"
      className={className}
    >
      {/* the sun, behind the range */}
      <path
        fill="var(--lacquer)"
        d="m75.5 65.2c-2 0-3.8 1.7-3.8 3.9 0 2 1.8 4.1 3.8 4.1 2.1 0 3.9-1.6 3.9-4 0-2.2-1.8-4-3.9-4z"
      />
      {/* four overlapping hills */}
      <g fill="var(--ink)">
        <path d="m48.2 77 2.9-2.1c1.9-1.5 2.8-1 3.5-0.4l-0.2 1c4-1.8 6-7.1 8.5-6.6 1.3 0.2 2.6 1.7 3.5 2.6l0.5 0.5c-1.5 2.4-3.5 3.9-6.9 4.9l-11.8 0.1z" />
        <path d="m61.9 77c3.6-0.9 5.1-3.9 6-4.5 1.5-1.4 2.8-0.1 3.3 0.1l4.2 3.5v0.5h-13.5v0.4z" />
        <path d="m75.4 76.9c6-3.3 6.7-6.3 8.7-5.7l1.3 0.9 5.2 4.8h-15.2z" />
        <path d="m87 72.6 1.5-1c1.7-1.1 3.5 0.8 4.7 1.6 1.5 1.3 1.2 1.4 2.7 1 1.8-0.2 3 0.8 5.5 2.7h-9.5l-4.9-4.3z" />
      </g>
      {/* the water, in seven strokes */}
      <g fill="var(--gold)" fillRule="evenodd" clipRule="evenodd">
        <path d="m49.7 77.9h8.9c-3 1-5.7 1.1-8.9 0z" />
        <path d="m68 77.9h14.9c-4.3 1.5-9.4 1.5-14.9 0z" />
        <path d="m92 77.9h8.4c-2.8 1.1-6 0.7-8.4 0z" />
        <path d="m55.2 79.5c5.7 0.1 5.7-2.9 12.8-0.9 2.4 0.8 4.7 1.8 7.6 0.4 0.8 0.5 2.3 1 4 1 3.3 0 5.1-2 8.4-1.5 2.5 0.4 4.9 1.6 7.9 1-2.2 1.1-4.9 0.4-7.4-0.5-3.8-0.6-6.9 1.7-9.8 1.5-1.7 0-2.7-0.6-3.1-0.6-5.6 2-7.5-0.9-12-1-2.6 0-5 1.7-8.4 0.6z" />
        <path d="m60.4 80.5c4.7-2 6.5 0.5 11.2 1-5.4 1.5-6.5-1.4-11.2-1z" />
        <path d="m75.2 80.5c0.8 0.6 2 0.9 3.5 1-2.5 1-4.6 1-6.2 0.1 1.2-0.1 2.1-0.4 2.7-1.1z" />
        <path d="m79.6 81.5c4.5 0 6.4-2.5 10-1.6l1.4 0.6c-5.3-0.6-6.1 2.1-11.4 1z" />
      </g>
    </svg>
  );
}
