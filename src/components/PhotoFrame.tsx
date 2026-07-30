"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import PhotoPlaceholder from "@/components/PhotoPlaceholder";
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
 * A photo in the site frame (.frame — see globals.css): gold edge, 2px
 * mount, inner hairline, and a caption plate under the frame rule, like a
 * mounted print with its label. Identical anatomy to the House Favorites
 * cards, which carry a name/price plate in the same slot.
 *
 * The caption is now ALWAYS printed. It used to float over the image and
 * only when there was no photo, so a slot changed shape the day a real
 * photo landed — and the room frames and the dish cards read as two
 * different objects.
 *
 * src === null → the shared placeholder (see PhotoPlaceholder).
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
    <figure className={`frame flex flex-col ${className}`}>
      <div
        ref={boxRef}
        className={`relative overflow-hidden ${revealed ? "pf-revealed" : ""}`}
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
            <PhotoPlaceholder />
          )}
        </div>
      </div>
      <figcaption className="frame-rule frame-caption px-3 py-2.5 text-ink/60">
        {photo.caption}
      </figcaption>
    </figure>
  );
}
