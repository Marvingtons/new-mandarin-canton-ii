interface GoldCornersProps {
  /** Arm length of each bracket, in px. */
  size?: number;
  /** How far the brackets sit outside the parent's box, in px. */
  inset?: number;
  className?: string;
}

/**
 * 花窗 — the lattice window, reduced to its corners.
 *
 * Four thin gold brackets that imply a frame without drawing one. This
 * is the restrained end of the lattice idea on purpose: a full carved
 * screen would fight the photography and tip the page from confident
 * into themed. Corners give the same geometry at a whisper.
 *
 * Requires a positioned parent.
 */
export default function GoldCorners({
  size = 14,
  inset = -6,
  className = "",
}: GoldCornersProps) {
  const arm = { width: size, height: size };
  const corners = [
    { key: "tl", style: { top: inset, left: inset, borderTopWidth: 1, borderLeftWidth: 1 } },
    { key: "tr", style: { top: inset, right: inset, borderTopWidth: 1, borderRightWidth: 1 } },
    { key: "bl", style: { bottom: inset, left: inset, borderBottomWidth: 1, borderLeftWidth: 1 } },
    { key: "br", style: { bottom: inset, right: inset, borderBottomWidth: 1, borderRightWidth: 1 } },
  ];

  return (
    <span aria-hidden="true" className={`pointer-events-none ${className}`}>
      {corners.map(({ key, style }) => (
        <span
          key={key}
          className="absolute border-gold/55"
          style={{ ...arm, ...style }}
        />
      ))}
    </span>
  );
}
