"use client";

import dynamic from "next/dynamic";

/**
 * The scroll-motion layer, loaded after hydration instead of in the first
 * bundle.
 *
 * SmoothScroll (Lenis) and HomeChoreography (GSAP, ScrollTrigger,
 * SplitText) render nothing; they attach motion to markup the server has
 * already painted. Statically imported, they put ~150 KB of library in the
 * scripts every page parses before it is interactive, for scenes that only
 * start once someone scrolls. `ssr: false` keeps them out of that set and
 * fetches them as their own chunks the moment the page hydrates.
 *
 * Safe because nothing they set is visible at first paint: the hero's own
 * entrance is CSS (HeroVideo's .hero-item), and every from-state the
 * choreography applies is on content below the fold, behind ScrollTriggers
 * that have not fired. The cost is that scroll smoothing starts a beat
 * after hydration rather than with it.
 */
export const SmoothScroll = dynamic(() => import("./SmoothScroll"), { ssr: false });
export const HomeChoreography = dynamic(() => import("./HomeChoreography"), {
  ssr: false,
});
