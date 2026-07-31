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
  /**
   * Override the manifest's aspect for this placement.
   *
   * The same photograph appears portrait in the homepage's three-up and
   * landscape in the About page's, and the crop is a property of where it
   * hangs rather than of the picture. Defaults to the photo's own aspect.
   */
  aspect?: SitePhoto["aspect"];
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
 * scrolled into view: a clip sweep plus a settle from 1.06 scale.
 *
 * PROGRESSIVE ENHANCEMENT, not decoration-first. The frame arms itself on
 * mount (`pf-armed`) and only then does any CSS hide the photograph — so no
 * JavaScript means the picture, not an empty gold frame, and the observer is
 * the thing that opens a curtain rather than the thing that makes the image
 * exist. Under prefers-reduced-motion the frame never arms and NO OBSERVER IS
 * CREATED: the server-rendered DOM is already the finished state. See the
 * pf-* rules in globals.css.
 */
export default function PhotoFrame({
  photo,
  revealDelay = 0,
  direction = "ltr",
  parallaxAmp = 8,
  sizes = "(min-width: 640px) 33vw, 100vw",
  aspect,
  className = "",
}: PhotoFrameProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!photo.src) return;
    const el = boxRef.current;
    if (!el) return;

    // The gate, checked here rather than in CSS so that "no observers
    // attached" is literally true. Duplicated from lib/motion/context's
    // prefersReducedMotion() on purpose: importing it would pull GSAP into
    // every page that hangs a photograph.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // `pf-armed` is applied to the DOM rather than held in React state: it is
    // the class that lets the CSS hide the photo at all, so it must not exist
    // for one render before the observer that undoes it. Adding it here means
    // arming and watching happen in the same tick, and a stray re-render that
    // dropped it would simply show the finished photograph.
    el.classList.add("pf-armed");

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
        style={{ aspectRatio: aspect ?? photo.aspect }}
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
