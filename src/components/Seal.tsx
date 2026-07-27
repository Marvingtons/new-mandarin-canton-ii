import { restaurant } from "@/data/restaurant";

/**
 * The official FU YUAN seal mark — bracket frame + 富源 — inlined
 * verbatim from public/brand/fu-yuan-seal.svg (the source of truth;
 * the icon/OG generators read that file directly). Artwork, colors,
 * and proportions are untouched.
 *
 * The mark is portrait (80 x 141.5 units): `size` sets the rendered
 * HEIGHT, width follows the aspect. Below 32px the full mark turns to
 * mud, so a small-size variant crops to 富 alone via the viewBox.
 */

const FRAME_D =
  "m110.6 19c-3.4-1.4-8.6-4.5-9.3-8.6h-57.6c-0.6 4.1-5.1 8.8-9.4 9.3l-0.1 118.8c3.8 0.6 8.7 3.7 9.5 9.5h58.7c0.7-4.8 4.6-8.5 9.2-9.3l-1-119.7z";

/** 富 (paths 1-4 of the artwork). */
const FU_DS = [
  "m97.7 26.9-5.4-3.7-2.8 2.8h-15l0.7-1c3.9-5.1-3.3-7.1-6.8-6.5l-0.4 0.4c1.7 1.6 2.3 3.9 2.3 6.9h-15.5c-0.5-0.9-1.1-1.9-2-2.6-0.2 3-1.6 6-4.5 7.8-2.3 1.4-2 5.4 1.5 5.4s5.4-4.8 5-8.8h35.6l-1.8 6.5 0.4 0.3 5.8-4.4 2.9-0.3c0.7 0 0.4 0.2 0.4-2.8z",
  "m88.4 32.7-5.6-4-1.1 1.2-2.1 2.5h-16.3l-5.6-0.3 1 2.6 5.3-0.7h23.1z",
  "m83.6 36.4-2.7 2.8h-16.6l-5.9-2.3h-0.1c0.5 4.7 0.1 11.1 0.1 13.5s5.6-0.2 5.6-1v-1.2h17.1v1.5c0 2.3 5.6-0.6 5.5-1.4-0.2-1.4 0-6.2 0-6.2s3.7-1.2 1.4-2.4zm-2.5 10.3h-17.1v-5.9h17.2v5.9z",
  "m88.6 50.7-2.8 2.9h-27l-5.8-2.4c0.6 6.3 0.1 19.7 0.1 23.9s5.4-0.2 5.4-1.6v-2.3h27.6v3.4c-0.4 2.5 5.6 0.1 5.5-1.9-0.1-2.3-0.2-16.3-0.2-16.3l1.9-0.9 0.3-0.8zm-19.2 19h-10.8v-7.1h10.9zm0.1-8.7h-10.9v-6h10.9zm16.4 8.6h-11v-7h11zm0.1-8.2h-11.2v-6.4h11.2z",
];

/** 源 (paths 5-10 of the artwork). */
const YUAN_DS = [
  "m59.1 88.8c-0.5-4.2-8.1-5.6-9.4-5.6-0.4 0-0.6 0.5 0 0.9 1.8 2.2 3.4 4.4 4.2 7.9 2 3.4 5.7 0 5.2-3.2z",
  "m45.7 96.7c-0.1 0.3-0.1 0.4 0.2 0.7 1.8 2.1 3.5 5.1 4.2 8.1 2.2 3.4 7.3-1.1 4.5-5-2.6-3-7.6-3.9-8.9-3.8z",
  "m60 98.2-9.6 21.7-4.2-0.5 0.1 1c3.7 1 4 3.9 2.8 9.5-0.8 2.8-0.4 7 3.5 6.5 2.2-0.5 3.3-3.3 3-6-0.5-3-0.9-6.5-0.5-8.9 0.7-4.9 5.2-22.5 5.2-23z",
  "m97.2 86.1-4.6-3.6-0.9 0.4-2.8 3.3h-20.5l-5.8-2.5c0.3 3.4 0.3 14.9 0.3 18.8-0.3 13.9-2.5 25.9-7.7 34.1l0.4 0.2c8.1-7.4 12.3-16.2 12.3-36.7v-12.2h10.4 0.2-0.3 0.2c0.3 0.7-0.1 5.8-1 8.1h-1l-5.3-2.3c0.3 2.9 0.3 15.9 0 21.3 0 2.2 5.1 0.1 5.1-1v-0.8h2.9c0.3 0.1 0.3 0.2 0.3 0.9v14.8c0 3.1-3.3 1.6-6.6 1.7l0.1 1c3.2 0.5 4.5 2.6 4.3 4.3s1.5 1.5 3.8 0.7c2.2-0.9 3.7-2.2 3.7-5.2v-17.7c0-0.3 0.1-0.5 0.3-0.6h3.6v2c0 2 5.2-0.6 5.1-1.6-0.2-0.9-0.1-14.9-0.1-14.9l1.6-1.1 0.3-0.8-4.9-3.8-2.7 3.1h-8.2l3.9-5.3 1.8-0.3 0.2-0.8-3.7-1.7h15.5c0.2 0 0.2-0.9-0.2-0.9zm-8.7 25.4h-12.3v-6.4h12.3zm0-7.8h-12.4v-6.3h12.4z",
  "m71.8 117.5c-2.1 6.2-5.6 11.9-8.2 16l0.3 0.2c3.2-1.3 9.5-7.2 11.7-11.3 3.8-0.4 1-3.4-3.8-4.9z",
  "m87.1 118-0.2 0.7c2.8 3.3 5 7.4 5.5 12.3 0.2 2.6 4.2 2.7 5-1.4 1.6-6.9-7.8-11.1-10.3-11.6z",
];

/** Full mark crop. */
const VIEWBOX_FULL = "32.5 8.5 80 141.5";
/** Small-size variant: 富 alone (frame + both characters mud below 32px). */
const VIEWBOX_SMALL = "46.3 17.9 52.4 59.5";

interface SealProps {
  /** Rendered height in px; width follows the mark's aspect. */
  size?: number;
  /**
   * "gold" is the mark as drawn — the default everywhere.
   *
   * "chop" recolors it to the lacquer red of a carved stone seal. This
   * is the ONLY red on the site outside the lacquer surfaces themselves,
   * which is exactly why it carries weight: reserve it for the one or
   * two moments where the chop stamps onto the page.
   */
  tone?: "gold" | "chop";
  className?: string;
}

export default function Seal({
  size = 44,
  tone = "gold",
  className = "",
}: SealProps) {
  if (!restaurant.chineseName) return null;
  const small = size < 32;
  const chop = tone === "chop";
  const stroke = chop ? "var(--lacquer)" : "#DEAE64";
  const fill = chop ? "var(--lacquer)" : "#EABD62";

  return (
    <svg
      role="img"
      aria-label={`${restaurant.chineseName} — ${restaurant.name} seal`}
      viewBox={small ? VIEWBOX_SMALL : VIEWBOX_FULL}
      style={{ height: size, width: "auto" }}
      className={className}
    >
      {!small && (
        <path
          fill="none"
          stroke={stroke}
          strokeWidth="1.3632"
          strokeMiterlimit="10"
          d={FRAME_D}
        />
      )}
      <g fill={fill}>
        {FU_DS.map((d, i) => (
          <path key={`fu-${i}`} d={d} />
        ))}
        {!small &&
          YUAN_DS.map((d, i) => <path key={`yuan-${i}`} d={d} />)}
      </g>
    </svg>
  );
}
