interface CandleGlowProps {
  /** Peak opacity of the wash. Keep this low — it is light, not a shape. */
  intensity?: number;
  /** CSS position of the glow's centre within its parent. */
  x?: string;
  y?: string;
  /** Diameter as a percentage of the parent's width. */
  spread?: string;
  className?: string;
}

/**
 * The warm light of a candle on the altar: a soft radial wash that
 * breathes on a long, irregular cycle (see .candle-glow in globals.css).
 *
 * Deliberately not a flicker. A flame that flickers on a web page reads
 * as a gif; light that swells and settles over eight seconds reads as a
 * room. Rests at its base opacity with no animation under reduced
 * motion, so it degrades to a plain warm wash rather than disappearing.
 */
export default function CandleGlow({
  intensity = 0.5,
  x = "50%",
  y = "60%",
  spread = "70%",
  className = "",
}: CandleGlowProps) {
  return (
    <div
      aria-hidden="true"
      className={`candle-glow pointer-events-none absolute inset-0 ${className}`}
      style={
        {
          "--glow-x": x,
          "--glow-y": y,
          "--glow-spread": spread,
          "--glow-peak": intensity,
        } as React.CSSProperties
      }
    />
  );
}
