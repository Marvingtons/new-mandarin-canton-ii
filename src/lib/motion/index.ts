/**
 * The site's motion toolkit.
 *
 * Every scroll-driven effect on the site is composed from these five
 * primitives, so the whole page shares one easing voice and one set of
 * entrance positions. Adding a bespoke tween somewhere is usually a sign
 * that a primitive needs an option, not that the page needs a one-off.
 *
 *   revealRise   fade + rise, staggered — the workhorse
 *   maskWipe     clip-path uncover — headers and imagery
 *   parallax     scroll-linked drift — layered images
 *   sealStamp    the 富源 chop pressing in — signature moments only
 *   smokeDrift   ambient incense; steamRise is its tighter sibling
 *
 * Usage is always the same shape:
 *
 *   const ctx = createMotionContext(() => { revealRise("[data-x]") });
 *   return () => ctx?.revert();
 *
 * createMotionContext returns null under prefers-reduced-motion, so the
 * builder never runs and no primitive needs its own fallback.
 */
export {
  createMotionContext,
  prefersReducedMotion,
  registerMotionPlugins,
  toElements,
} from "./context";
export { DUR, EASE, START } from "./tokens";
export { maskWipe, revealRise } from "./reveal";
export type { MaskWipeOptions, RevealRiseOptions } from "./reveal";
export { parallax } from "./parallax";
export type { ParallaxOptions } from "./parallax";
export { sealStamp } from "./sealStamp";
export type { SealStampOptions } from "./sealStamp";
export { smokeDrift, steamRise } from "./smoke";
export type { DriftOptions } from "./smoke";
