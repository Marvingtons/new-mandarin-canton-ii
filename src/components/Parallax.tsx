"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

interface ParallaxProps {
  children: ReactNode;
  /** Total translateY (px) applied across the scroll through the parent. */
  distance?: number;
  className?: string;
}

/**
 * Gentle scroll parallax: translates its content up to `distance` px as
 * the parent section moves through the viewport. Mutates the transform
 * directly (no re-renders); does nothing under prefers-reduced-motion.
 */
export default function Parallax({
  children,
  distance = -12,
  className = "",
}: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    const anchor = el?.parentElement;
    if (!el || !anchor) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      const r = anchor.getBoundingClientRect();
      const total = window.innerHeight + r.height;
      const progress = Math.min(1, Math.max(0, (window.innerHeight - r.top) / total));
      el.style.transform = `translateY(${(progress * distance).toFixed(1)}px)`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [distance]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
