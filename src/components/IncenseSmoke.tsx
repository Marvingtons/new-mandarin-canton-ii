interface IncenseSmokeProps {
  /** How many wisps. Two behind the hero; three at the altar. */
  count?: number;
  /**
   * Opacity ceiling for the whole field, on top of each wisp's own very
   * low peak. Behind the hero this wants to be almost subliminal.
   */
  intensity?: number;
  /**
   * Which ground the smoke sits on. "dark" is pale smoke for lacquer and
   * ink surfaces; "light" is a warm grey haze for paper and ivory, where
   * pale smoke would be invisible.
   */
  on?: "dark" | "light";
  className?: string;
}

/**
 * 香 — the incense rising from the family altar, the blessing that hangs
 * over this kitchen.
 *
 * Purely decorative and purely additive: every wisp rests at opacity 0,
 * so with no JS — or under prefers-reduced-motion, where the motion
 * context never builds — this renders as literally nothing. It can be
 * dropped into any positioned parent without risk.
 *
 * Animated by `smokeDrift` via [data-smoke-wisp].
 */
export default function IncenseSmoke({
  count = 2,
  intensity = 0.5,
  on = "dark",
  className = "",
}: IncenseSmokeProps) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      style={{ opacity: intensity }}
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          data-smoke-wisp
          className={`smoke-wisp${on === "light" ? " smoke-wisp-warm" : ""}`}
          // Spread the wisps across the field rather than stacking them;
          // the offset keeps the group off dead-centre.
          style={{ left: `${18 + (i * 64) / Math.max(count, 1)}%` }}
        />
      ))}
    </div>
  );
}
