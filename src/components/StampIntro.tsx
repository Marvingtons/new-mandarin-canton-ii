"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Seal from "@/components/Seal";
import { restaurant } from "@/data/restaurant";

const emptySubscribe = (): (() => void) => () => {};

// Decided once per page load, synchronously before the first client
// render. Plays on every full page load (client-side navigations keep
// the layout mounted, so they never replay it).
let decision: boolean | null = null;

function shouldPlay(): boolean {
  if (decision !== null) return decision;
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  decision = Boolean(restaurant.chineseName) && !reducedMotion;
  return decision;
}

/**
 * Ceremonial reveal: the 富源 seal stamps onto the ivory "paper"
 * covering the viewport, an ink ring pulses, the name fades in, then
 * the whole sheet lifts to reveal the hero already rendered beneath.
 * Total ≤ 1.4s; plays on every full page load, skipped under
 * prefers-reduced-motion. Timings live in globals.css.
 */
export default function StampIntro() {
  const play = useSyncExternalStore(emptySubscribe, shouldPlay, () => false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!play) return;
    // Safety net: if animation events never fire, still unmount.
    const timeout = setTimeout(() => setDone(true), 2000);
    return () => clearTimeout(timeout);
  }, [play]);

  if (!play || done) return null;

  return (
    <div
      aria-hidden="true"
      className="intro-overlay fixed inset-0 z-[100] flex flex-col items-center justify-center bg-ivory"
      onAnimationEnd={(e) => {
        if (e.animationName === "intro-out") setDone(true);
      }}
    >
      <div className="intro-stamp-press relative">
        <Seal size={112} />
        {/* The ink bleed: one thin ring pulsing outward from the seal edge */}
        <span
          aria-hidden="true"
          className="intro-ink-ring absolute inset-0 rounded-[6px] border-2 border-lacquer"
        />
      </div>
      <p className="intro-name-in mt-6 font-display text-lg tracking-wide text-ink">
        {restaurant.name}
      </p>
    </div>
  );
}
