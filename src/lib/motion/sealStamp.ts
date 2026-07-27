import gsap from "gsap";
import { EASE, START } from "./tokens";

export interface SealStampOptions {
  /** What fires the stamp. Defaults to the seal itself. */
  trigger?: Element | null;
  start?: string;
  /**
   * The ink bleed: a ring element that pulses outward as the chop lands.
   * Optional — without it the stamp is just the press.
   */
  ring?: Element | null;
  /** Scale the seal falls FROM. Above 1: it presses down onto the page. */
  from?: number;
  /** Degrees of tilt it settles at. A chop is never placed perfectly straight. */
  rotation?: number;
  duration?: number;
  /** Build it paused, for callers driving the stamp off a scrub. */
  paused?: boolean;
}

/**
 * The 富源 chop pressing into the page: it falls from slightly too large,
 * overshoots, and settles a couple of degrees off-square — the way a
 * hand-held seal actually lands. An ink ring bleeds outward behind it.
 *
 * This is the site's signature entrance and the ONLY thing that uses the
 * overshoot ease. Use it sparingly — twice on a page at most, or it
 * stops reading as a signature and starts reading as a habit.
 */
export function sealStamp(
  target: Element | null | undefined,
  options: SealStampOptions = {},
): gsap.core.Timeline | null {
  if (!target) return null;

  const {
    trigger,
    start = START.late,
    ring,
    from = 1.35,
    rotation = -3,
    duration = 0.45,
    paused = false,
  } = options;

  const tl = gsap.timeline(
    paused
      ? { paused: true }
      : { scrollTrigger: { trigger: trigger ?? target, start, once: true } },
  );

  tl.fromTo(
    target,
    { scale: from, rotation: rotation * 2, autoAlpha: 0 },
    { scale: 1, rotation, autoAlpha: 1, duration, ease: EASE.stamp },
  );

  // The bleed trails the press slightly — ink spreads after contact,
  // not during it.
  if (ring) {
    tl.fromTo(
      ring,
      { scale: 1, autoAlpha: 0.7 },
      { scale: 1.35, autoAlpha: 0, duration: 0.5, ease: EASE.soft },
      duration * 0.8,
    );
  }

  return tl;
}
