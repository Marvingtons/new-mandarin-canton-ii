/**
 * Coordination between the intro overlay and elements that animate in
 * after it lifts (see LoadingOverlay.tsx and HeroVideo.tsx).
 */
const EVENT = "nmc:intro-lifted";

/** Set the first time the stamp plays; read on every later page load. */
export const INTRO_SESSION_KEY = "nmc2-seal-stamp-seen";

/**
 * Set on <html> before the first paint when the intro must NOT be shown.
 * `[data-intro-skip] .stamp { display: none }` in globals.css is the whole
 * of the repeat-visit path.
 */
export const INTRO_SKIP_ATTR = "data-intro-skip";

/**
 * If React never takes over, clear the curtain anyway. Long enough that
 * it can never race a working page — the overlay's own hard cap is 1.8s
 * and it has unmounted well before this — and short enough that a broken
 * hydration is a slow page rather than a black screen.
 */
const INTRO_FAILSAFE_MS = 8000;

/**
 * THE PRE-PAINT DECISION, as source, to be run inline as the first thing
 * in <body>.
 *
 * The overlay is now in the SERVER-RENDERED HTML, because that is the only
 * way the first paint can be the curtain rather than the hero. That trades
 * one problem for another: the server cannot read sessionStorage, so it
 * cannot know this is a repeat visit, and a returning visitor would get a
 * frame of ink before hydration unmounted it.
 *
 * So the decision moves ahead of paint. This runs synchronously while the
 * parser is still above the overlay's markup — it has not been parsed yet,
 * let alone painted — and stamps an attribute the stylesheet already has a
 * rule for. Both directions hold with nothing to hydrate first: on a first
 * visit the ink is simply there, on a repeat visit it never exists.
 *
 * NOT next/script beforeInteractive: that guarantees ordering against
 * Next's own bundles, not against the paint of the markup below it. An
 * inline classic script does, because the parser blocks on it.
 *
 * A THROW MEANS PLAY, matching introWillPlay(): sessionStorage is
 * unavailable in some privacy modes, and the honest reading of "I cannot
 * tell whether they have seen it" is that they have not.
 *
 * Minified by hand rather than by the bundler — it is inlined verbatim
 * into every HTML response, so its bytes are on the critical path.
 */
export const INTRO_GATE_SCRIPT =
  `(function(){var h=document.documentElement,a=${JSON.stringify(INTRO_SKIP_ATTR)},s=location.pathname!=="/";` +
  `if(!s){try{s=sessionStorage.getItem(${JSON.stringify(INTRO_SESSION_KEY)})!==null}catch(e){s=false}}` +
  `if(s){h.setAttribute(a,"")}else{setTimeout(function(){h.setAttribute(a,"")},${INTRO_FAILSAFE_MS})}` +
  `})()`;

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
  // ONCE IT HAS LIFTED IT IS OVER, and this is checked before the memo
  // rather than folded into it. `willPlay` is fixed for the document, but
  // the overlay unmounts on a client-side route change and remounts with
  // a fresh `phase` — so /, then /menu, then back to / re-rendered the
  // curtain and played the whole stamp again, in a session that had
  // already seen it. The session key cannot catch that: the overlay wrote
  // it, and the memo answered from before it was written. `lifted` is the
  // fact that actually distinguishes the two.
  if (lifted) return false;
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
