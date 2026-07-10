import type Lenis from "lenis";

/**
 * Shared handle to the active Lenis instance (set by SmoothScroll),
 * for features that drive programmatic scrolling — e.g. the menu
 * category-nav flights. Null under prefers-reduced-motion.
 */
let lenis: Lenis | null = null;

export function setLenis(instance: Lenis | null): void {
  lenis = instance;
}

export function getLenis(): Lenis | null {
  return lenis;
}
