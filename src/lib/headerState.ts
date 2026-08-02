import { useSyncExternalStore } from "react";

/**
 * Bridge between the homepage's hero ScrollTrigger and the two pieces of
 * chrome that key off the hero's exit — the Header, whose
 * transparent→solid switch rides the same trigger instead of its own
 * threshold, and the mobile StickyOrderBar, which does not exist until
 * the hero's own CTAs have left. (Both keep a plain scroll fallback for
 * reduced-motion visitors, where no triggers exist.)
 */
let solid = false;
const subscribers = new Set<() => void>();

export function setHeaderSolid(value: boolean): void {
  if (value === solid) return;
  solid = value;
  subscribers.forEach((cb) => cb());
}

export function subscribeHeaderSolid(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function getHeaderSolid(): boolean {
  return solid;
}

const subscribeScroll = (cb: () => void): (() => void) => {
  window.addEventListener("scroll", cb, { passive: true });
  window.addEventListener("resize", cb);
  return () => {
    window.removeEventListener("scroll", cb);
    window.removeEventListener("resize", cb);
  };
};

/**
 * ONE definition of "the hero is behind us", shared by Header and
 * StickyOrderBar so the header cannot turn solid on a different scroll
 * position from the one the order bar arrives at. Both signals are OR'd
 * and always agree: the ScrollTrigger is primary, the plain threshold is
 * the reduced-motion fallback.
 *
 * Both hands back `false` from the server snapshot, which is the resting
 * state the server renders — nothing keyed off this may reserve space,
 * or the first paint moves.
 *
 * Hooks in a lib module: both callers are client components. This is
 * here, not in either of them, precisely so it cannot be two thresholds.
 */
export function usePastHero(): boolean {
  const scrolledPast = useSyncExternalStore(
    subscribeScroll,
    () => window.scrollY > window.innerHeight - 96,
    () => false,
  );
  const triggered = useSyncExternalStore(
    subscribeHeaderSolid,
    getHeaderSolid,
    () => false,
  );
  return scrolledPast || triggered;
}
