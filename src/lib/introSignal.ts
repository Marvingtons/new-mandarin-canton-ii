/**
 * Coordination between the intro overlay and elements that animate in
 * after it lifts (see LoadingOverlay.tsx and HeroVideo.tsx).
 */
const EVENT = "nmc:intro-lifted";

let lifted = false;

/** Called by the intro overlay the moment its fade-out begins. */
export function signalIntroLifted(): void {
  if (lifted) return;
  lifted = true;
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Runs `cb` once the intro lifts; if it already has, `cb` runs on the
 * next tick (never synchronously). Returns an unsubscribe function.
 */
export function onIntroLifted(cb: () => void): () => void {
  if (lifted) {
    const t = setTimeout(cb, 0);
    return () => clearTimeout(t);
  }
  const handler = (): void => cb();
  window.addEventListener(EVENT, handler, { once: true });
  return () => window.removeEventListener(EVENT, handler);
}
