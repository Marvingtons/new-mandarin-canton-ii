/**
 * The POS draws in spec pixels (components/kitchen/pos.module.css, --u), not
 * Icon's 16px design size: size={posIcon(24)} renders 24px, 30px under 大字.
 * Its own module so Icon.tsx exports components only (Fast Refresh).
 */
export function posIcon(px: number): number {
  return (px * 16) / 22;
}
