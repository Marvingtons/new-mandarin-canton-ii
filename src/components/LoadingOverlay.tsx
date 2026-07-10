"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { signalIntroLifted } from "@/lib/introSignal";

const SESSION_KEY = "nmc2-goldleaf-seen";
/**
 * Gold-leaf choreography (CSS-driven, see globals.css):
 *   0.00s  lacquer field settles in from black
 *   0.25s  debossed impression of the logo fades in
 *   0.65s  gold fill sweeps across (1.4s, soft feathered mask edge)
 *   1.90s  one glint pass rides the sweep's tail (0.6s)
 *   ~3.0s  hold ends → overlay lifts
 */
const MIN_SHOW_MS = 3000;
/** Hard cap — dismiss even if the page never finishes loading. */
const MAX_WAIT_MS = 8000;
const FADE_MS = 500;

const emptySubscribe = (): (() => void) => () => {};

// Decided once per page load, synchronously before the first client
// render — repeat navigations in the same session never see a frame.
let decision: boolean | null = null;

function shouldPlay(): boolean {
  if (decision !== null) return decision;
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  let seen = false;
  try {
    seen = sessionStorage.getItem(SESSION_KEY) !== null;
  } catch {
    // sessionStorage unavailable — treat as unseen
  }
  decision = !reducedMotion && !seen;
  return decision;
}

/**
 * First-visit-per-session preloader: the 富源 lockup appears as a
 * debossed impression in the textured lacquer field, fills with gold
 * via a sweeping feathered mask, catches one glint, then the sheet
 * lifts (firing the intro signal the hero listens to). Plays once —
 * no looping. Skipped entirely under prefers-reduced-motion and on
 * repeat visits in the same session.
 */
export default function LoadingOverlay() {
  const play = useSyncExternalStore(emptySubscribe, shouldPlay, () => false);
  const [phase, setPhase] = useState<"loading" | "fading" | "gone">("loading");

  useEffect(() => {
    if (!play) return;
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // best effort
    }
  }, [play]);

  useEffect(() => {
    if (!play) return;
    if (phase === "loading") {
      let pageLoaded = document.readyState === "complete";
      let choreographyDone = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const dismiss = () => setPhase((p) => (p === "loading" ? "fading" : p));
      const maybeDismiss = () => {
        if (pageLoaded && choreographyDone) dismiss();
      };

      timers.push(
        setTimeout(() => {
          choreographyDone = true;
          maybeDismiss();
        }, MIN_SHOW_MS),
      );

      const onPageLoad = () => {
        pageLoaded = true;
        maybeDismiss();
      };
      if (!pageLoaded) window.addEventListener("load", onPageLoad);
      timers.push(setTimeout(dismiss, MAX_WAIT_MS));

      return () => {
        window.removeEventListener("load", onPageLoad);
        timers.forEach(clearTimeout);
      };
    }
    if (phase === "fading") {
      const t = setTimeout(() => {
        setPhase("gone");
        // Signal once the sheet has fully lifted — the hero video
        // starts exactly here, not behind the translucent fade.
        signalIntroLifted();
      }, FADE_MS);
      return () => clearTimeout(t);
    }
  }, [play, phase]);

  if (!play || phase === "gone") return null;

  return (
    <div
      aria-busy="true"
      className={`loading-overlay${phase === "fading" ? " loading-overlay-out" : ""}`}
    >
      {/* Textured lacquer field, settling in from black */}
      <div aria-hidden="true" className="lo-field" />
      <div className="lo-logo">
        {/* Debossed impression: same SVG, recolored via CSS filter only */}
        {/* eslint-disable-next-line @next/next/no-img-element -- decorative layer of the animation stack */}
        <img className="lo-emboss" src="/fu-yuan-logo.svg" alt="" width={145} height={196} />
        {/* Gold artwork, revealed left-to-right by the mask sweep */}
        {/* eslint-disable-next-line @next/next/no-img-element -- decorative layer of the animation stack */}
        <img className="lo-gold" src="/fu-yuan-logo.svg" alt="" width={145} height={196} />
        {/* One glint pass, masked to the logo's own shapes */}
        <div aria-hidden="true" className="lo-glint" />
      </div>
      {/* Without JS the dismiss never fires — hide the overlay entirely */}
      <noscript>
        <style>{`.loading-overlay{display:none}`}</style>
      </noscript>
    </div>
  );
}
