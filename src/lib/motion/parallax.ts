import gsap from "gsap";
import { toElements } from "./context";
import { EASE } from "./tokens";

export interface ParallaxOptions {
  /** The scroll range that drives the offset. Defaults to the target itself. */
  trigger?: Element | null;
  /**
   * Peak offset as a PERCENTAGE of the element's own height. Percent, not
   * px, so the effect scales with the element instead of overwhelming it
   * on mobile. Travel runs -amount → +amount across the trigger's range.
   */
  amount?: number;
  /** Seconds of catch-up lag. 1 is a soft follow; true is thumb-locked. */
  scrub?: number | boolean;
}

/**
 * Scroll-linked vertical drift for layered imagery.
 *
 * The element must be able to move without revealing an edge — give it
 * an overflow-hidden parent and let the inner layer be taller than the
 * frame. `yPercent` keeps this on the compositor (no layout, no jank),
 * and because it's a fromTo the midpoint of the scroll range is the
 * element's natural position.
 */
export function parallax(
  target: string | Element | Element[] | NodeListOf<Element> | null | undefined,
  options: ParallaxOptions = {},
): gsap.core.Tween | null {
  const els = toElements(target);
  if (!els.length) return null;

  const { trigger, amount = 8, scrub = 1 } = options;

  return gsap.fromTo(
    els,
    { yPercent: -amount },
    {
      yPercent: amount,
      ease: EASE.none,
      scrollTrigger: {
        trigger: trigger ?? els[0],
        start: "top bottom",
        end: "bottom top",
        scrub,
      },
    },
  );
}
