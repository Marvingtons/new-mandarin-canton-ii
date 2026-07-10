"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  /** Plain-fade variant (no rise) for utility sections. */
  fade?: boolean;
  className?: string;
}

/**
 * One-time scroll reveal: fades/rises its content when 25% enters the
 * viewport. Uses the motion tokens; reduced motion shows content
 * immediately (see .reveal rules in globals.css).
 */
export default function Reveal({
  children,
  fade = false,
  className = "",
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${fade ? "reveal-fade" : ""} ${shown ? "reveal-in" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
