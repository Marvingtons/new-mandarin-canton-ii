"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import Seal from "@/components/Seal";
import type { SitePhoto } from "@/data/images";

interface PhotoFrameProps {
  photo: SitePhoto;
  /** Delay (ms) before the curtain reveal — for staggering rows. */
  revealDelay?: number;
  /** Curtain direction; alternate within a row so it feels composed. */
  direction?: "ltr" | "rtl";
  /** Scrubbed parallax amplitude (yPercent) applied by HomeChoreography. */
  parallaxAmp?: number;
  /** next/image `sizes` hint used when a real photo is set. */
  sizes?: string;
  className?: string;
}

/**
 * Double gold frame — 1px border, 2px mount gap, 1px inner hairline —
 * around a fixed-aspect box, like a mounted print.
 *
 * src === null → the designed placeholder: warm paper + grain, ghost
 * 富源 seal, caption in letterspaced caps. Visible by design.
 * src set    → next/image fill with a one-time curtain reveal when 25%
 * scrolled into view (clip sweep + settle from 1.06 scale; plain fade
 * under prefers-reduced-motion). See globals.css for the pf-* rules.
 */
export default function PhotoFrame({
  photo,
  revealDelay = 0,
  direction = "ltr",
  parallaxAmp = 8,
  sizes = "(min-width: 640px) 33vw, 100vw",
  className = "",
}: PhotoFrameProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!photo.src) return;
    const el = boxRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRevealed(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [photo.src]);

  return (
    <figure className={`border border-gold/60 p-[2px] ${className}`}>
      <div
        ref={boxRef}
        className={`relative overflow-hidden border border-gold/45 ${revealed ? "pf-revealed" : ""}`}
        style={{ aspectRatio: photo.aspect }}
      >
        {/* Inner surfaces sit in an over-tall wrapper so the scrubbed
            parallax slides them within the mount without exposing edges */}
        <div
          data-pf-inner
          data-pf-parallax={parallaxAmp}
          className="absolute inset-x-0 -bottom-[14%] -top-[14%]"
        >
          {photo.src ? (
            <div
              className={`pf-media ${direction === "rtl" ? "pf-media-rtl" : ""} absolute inset-0`}
              style={
                { "--pf-delay": `${revealDelay}ms` } as React.CSSProperties
              }
            >
              <Image
                src={photo.src}
                alt={photo.alt}
                fill
                sizes={sizes}
                className="object-cover"
              />
            </div>
          ) : (
            <>
              <div className="absolute inset-0 bg-paper" />
              {/* the red paper texture, desaturated, doubles as grain */}
              <div
                aria-hidden="true"
                className="absolute inset-0 opacity-15 grayscale mix-blend-multiply"
                style={{
                  backgroundImage: "url('/bg-red.jpg')",
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              />
              <div
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center"
              >
                <div className="pf-ghost">
                  <Seal size={88} className="opacity-[0.06]" />
                </div>
              </div>
            </>
          )}
        </div>
        {!photo.src && (
          <span className="absolute bottom-2 left-3 text-[0.62rem] uppercase tracking-[0.22em] text-ink/60">
            {photo.caption}
          </span>
        )}
      </div>
    </figure>
  );
}
