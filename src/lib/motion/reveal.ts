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
  /**
   * Travel distance in px. Keep small — this is a settle, not an entrance.
   * The default is 14: far enough to read as arriving, near enough that a
   * reader already looking at the element does not watch it move.
   */
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
    y = 14,
    stagger = 0.08,
    duration = 0.6,
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

