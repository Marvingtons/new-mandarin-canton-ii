import gsap from "gsap";
import { toElements } from "./context";
import { EASE } from "./tokens";

/**
 * Incense and steam — the site's ambient motion.
 *
 * Both helpers animate opacity from 0 up and back to 0 over one cycle,
 * which is what makes an infinite repeat seamless: the loop point is
 * fully transparent, so there is nothing to see snapping back. Each wisp
 * gets its own duration and delay so the group never pulses in unison.
 *
 * These run continuously, so they are the one place on the site where
 * `will-change` is justified — and they are also the first thing to
 * switch off under reduced motion (the motion context simply never
 * builds them).
 */

export interface DriftOptions {
  /** Peak travel in px. Negative is up. */
  rise?: number;
  /** Horizontal wander in px at the top of the rise. */
  drift?: number;
  /** Seconds for one wisp's full cycle. Each wisp varies around this. */
  duration?: number;
  /** Opacity at the midpoint of the cycle. Keep this very low. */
  peak?: number;
  /** Seconds between each wisp starting. */
  stagger?: number;
}

/**
 * Incense smoke: slow, tall, wandering. For the altar and behind the
 * hero. Nothing about this should ever be legible as "an animation" —
 * if a visitor notices it, it's too strong.
 */
export function smokeDrift(
  target: string | Element | Element[] | NodeListOf<Element> | null | undefined,
  options: DriftOptions = {},
): gsap.core.Timeline[] {
  const els = toElements(target);
  if (!els.length) return [];

  const {
    rise = -140,
    drift = 26,
    duration = 14,
    peak = 0.5,
    stagger = 3.5,
  } = options;

  return els.map((el, i) => {
    // Alternate the lean so wisps separate as they climb.
    const lean = i % 2 === 0 ? drift : -drift * 0.7;
    // Prime numbers-ish spread: no two wisps share a period, so the
    // group never resynchronizes into a visible pulse.
    const cycle = duration + i * 2.7;

    const tl = gsap.timeline({ repeat: -1, delay: i * stagger });
    tl.fromTo(
      el,
      { y: 0, x: 0, scale: 0.85, autoAlpha: 0 },
      {
        y: rise,
        x: lean,
        scale: 1.25,
        duration: cycle,
        ease: "none",
      },
      0,
    )
      .to(el, { autoAlpha: peak, duration: cycle * 0.35, ease: EASE.soft }, 0)
      .to(
        el,
        { autoAlpha: 0, duration: cycle * 0.45, ease: EASE.soft },
        cycle * 0.55,
      );
    return tl;
  });
}

/**
 * Steam off a hot dish: shorter, faster, and tighter than incense — it
 * hugs the plate rather than climbing the frame.
 */
export function steamRise(
  target: string | Element | Element[] | NodeListOf<Element> | null | undefined,
  options: DriftOptions = {},
): gsap.core.Timeline[] {
  return smokeDrift(target, {
    rise: -70,
    drift: 14,
    duration: 7,
    peak: 0.34,
    stagger: 1.6,
    ...options,
  });
}
