/**
 * Motion tokens — the site's single vocabulary for timing and easing.
 *
 * These MIRROR the CSS custom properties in globals.css. GSAP can't read
 * a cubic-bezier() from a CSS variable, so the two are kept in sync by
 * hand; the mapping is:
 *
 *   --ease-out-soft  cubic-bezier(.25,.46,.45,.94)  ≈  EASE.soft
 *   --ease-stamp     cubic-bezier(.34,1.56,.64,1)   ≈  EASE.stamp
 *   --t-slow         700ms                          =  DUR.slow
 *
 * Change a value here and its CSS twin together, or the JS-driven and
 * CSS-driven halves of the page start easing differently.
 */

/**
 * ONE easing curve does the work. `soft` is the site's voice — slow out,
 * no bounce, confident. Reach for the others only where noted.
 */
export const EASE = {
  /** The workhorse. Every reveal, wipe, and fade uses this. */
  soft: "power1.out",
  /** Slightly longer tail — for larger travel (parallax settles, scale). */
  glide: "power2.out",
  /** The stamp's overshoot. ONLY for the seal — nothing else bounces. */
  stamp: "back.out(1.7)",
  /** Scrubbed timelines: the thumb IS the easing. */
  none: "none",
} as const;

/** Durations in SECONDS (GSAP's unit), matching the CSS ms tokens. */
export const DUR = {
  fast: 0.15,
  med: 0.3,
  slow: 0.7,
  ambient: 2.4,
} as const;

/**
 * Shared ScrollTrigger start positions. Using named constants keeps
 * every section entering at the same point in the viewport — the single
 * biggest contributor to a page feeling "composed" rather than busy.
 */
export const START = {
  /** Default section entrance: fires with a comfortable margin. */
  enter: "top 85%",
  /** For elements that should hold until they're properly on screen. */
  late: "top 75%",
  /** Utility fades near the bottom of the fold. */
  edge: "top 92%",
} as const;
