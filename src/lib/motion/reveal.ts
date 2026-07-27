import gsap from "gsap";
import { toElements } from "./context";
import { EASE, START } from "./tokens";

/**
 * The two entrance primitives. Between them they cover almost every
 * "appears as you scroll to it" moment on the site.
 *
 * Both are `from`/`fromTo` tweens with immediateRender, so the resting
 * state in the markup is the FINAL state — nothing is hidden in CSS. A
 * visitor with JS disabled, or with reduced motion on (the context
 * never builds), simply sees the finished page.
 */

export interface RevealRiseOptions {
  /** Element whose scroll position fires the tween. Defaults to the first target. */
  trigger?: Element | null;
  start?: string;
  /** Travel distance in px. Keep small — this is a settle, not an entrance. */
  y?: number;
  stagger?: number;
  duration?: number;
  delay?: number;
  /**
   * Strip inline styles when finished. On by default so component-owned
   * hover/transition styles are never left fighting stale GSAP values.
   */
  clear?: boolean;
}

/**
 * Staggered fade + rise — the workhorse. Text blocks, card grids, list
 * items. Returns null when nothing matched, so callers can chain safely.
 */
export function revealRise(
  target: string | Element | Element[] | NodeListOf<Element> | null | undefined,
  options: RevealRiseOptions = {},
): gsap.core.Tween | null {
  const els = toElements(target);
  if (!els.length) return null;

  const {
    trigger,
    start = START.enter,
    y = 20,
    stagger = 0.08,
    duration = 0.7,
    delay = 0,
    clear = true,
  } = options;

  return gsap.from(els, {
    autoAlpha: 0,
    y,
    duration,
    stagger,
    delay,
    ease: EASE.soft,
    ...(clear ? { clearProps: "all" } : {}),
    scrollTrigger: { trigger: trigger ?? els[0], start, once: true },
  });
}

export interface MaskWipeOptions {
  trigger?: Element | null;
  start?: string;
  /** Side the mask retreats toward. */
  direction?: "ltr" | "rtl";
  stagger?: number;
  duration?: number;
  delay?: number;
  clear?: boolean;
}

/**
 * clip-path wipe — the mask pulls back to uncover the element in place.
 * Reserved for headers and imagery: it reads as more deliberate than a
 * rise, so overusing it flattens the page's hierarchy.
 *
 * Animating clip-path is compositor-friendly here because the element
 * itself never moves — no layout, no reflow.
 */
export function maskWipe(
  target: string | Element | Element[] | NodeListOf<Element> | null | undefined,
  options: MaskWipeOptions = {},
): gsap.core.Tween | null {
  const els = toElements(target);
  if (!els.length) return null;

  const {
    trigger,
    start = START.enter,
    direction = "ltr",
    stagger = 0.1,
    duration = 0.9,
    delay = 0,
    clear = true,
  } = options;

  const hidden =
    direction === "rtl" ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)";

  return gsap.fromTo(
    els,
    { clipPath: hidden },
    {
      clipPath: "inset(0% 0% 0% 0%)",
      duration,
      stagger,
      delay,
      ease: EASE.soft,
      ...(clear ? { clearProps: "clipPath" } : {}),
      scrollTrigger: { trigger: trigger ?? els[0], start, once: true },
    },
  );
}
