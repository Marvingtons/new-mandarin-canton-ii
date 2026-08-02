import { restaurant } from "@/data/restaurant";
import {
  FRAME_D,
  FU_DS,
  SEAL_GOLD_FILL,
  SEAL_GOLD_STROKE,
  VIEWBOX_FULL,
  VIEWBOX_SMALL,
  YUAN_DS,
} from "@/lib/brand/seal";

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

/*
 * Geometry moved to @/lib/brand/seal — the stamp in LoadingOverlay needs
 * the same paths (and the frame's measured length) to animate them, and two
 * inlined copies of an official mark is exactly how the two drift apart.
 */

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
  const stroke = chop ? "var(--lacquer)" : SEAL_GOLD_STROKE;
  const fill = chop ? "var(--lacquer)" : SEAL_GOLD_FILL;

  return (
    <svg
      role="img"
      aria-label={`${restaurant.chineseName}, ${restaurant.name} seal`}
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
