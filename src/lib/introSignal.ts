/**
 * Coordination between the intro overlay and elements that animate in
 * after it lifts (see LoadingOverlay.tsx and HeroVideo.tsx).
 */
const EVENT = "nmc:intro-lifted";

/** Set the first time the stamp plays; read on every later page load. */
export const INTRO_SESSION_KEY = "nmc2-seal-stamp-seen";

let lifted = false;
/** Memoised for the life of the document — see introWillPlay. */
let willPlay: boolean | null = null;

/**
 * "Is there an intro to wait for?" — asked by the overlay, which decides
 * whether to render, and by the hero, which decides whether to hold its
 * copy back until the curtain lifts.
 *
 * BOTH ASK THE SAME FUNCTION, and it does not look at the DOM. The hero
 * used to answer this with `document.querySelector(".loading-overlay")`,
 * which was wrong in two independent ways. It hardcoded a class name that
 * a rename silently broke; and even spelled correctly it lost a race it
 * could not win — the overlay reads sessionStorage through
 * useSyncExternalStore, whose SERVER snapshot is `false`, so on the first
 * commit the overlay renders nothing and the element the hero is looking
 * for does not exist yet. Measured before the fix: the hero copy finished
 * staggering in at 1451ms behind a screen that did not lift until 1951ms.
 *
 * The answer is memoised because the overlay WRITES the session key as
 * soon as it commits to playing. Without the cache, whichever component
 * asked second would be told "no intro" by the flag the first one just
 * set. Cached, the ordering stops mattering: the first caller fixes the
 * answer for the page load and both get it.
 */
export function introWillPlay(): boolean {
  if (willPlay !== null) return willPlay;
  if (typeof window === "undefined") return false;
  let seen = false;
  try {
    seen = sessionStorage.getItem(INTRO_SESSION_KEY) !== null;
  } catch {
    // sessionStorage unavailable (private mode, blocked) — treat as unseen
  }
  // Homepage only. Ordering food is not a moment for ceremony.
  willPlay = window.location.pathname === "/" && !seen;
  return willPlay;
}

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
