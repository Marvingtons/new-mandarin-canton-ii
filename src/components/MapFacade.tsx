"use client";

import { useState } from "react";

interface MapFacadeProps {
  /** The keyless Google Maps embed URL. */
  src: string;
  /** iframe title once loaded, e.g. "Map to New Mandarin Canton II, …". */
  title: string;
  /** Button text, already translated. */
  label: string;
  /** The "this is a placeholder" line printed on the still, translated. */
  note: string;
  /** The address, printed on the still and read with the button. */
  address: string;
}

/**
 * The footer map, as a still until someone asks for it.
 *
 * WHY. The footer is on every page, and the live embed it used to render
 * pulls Google Maps' own scripts, styles and tiles (several hundred KB, a
 * dozen third-party requests) for every visitor who scrolls to the bottom,
 * almost none of whom use it: the contact band directly above already has
 * Get Directions, which opens the real app. Now the map costs nothing until
 * it is tapped, and tapping it gives exactly the embed it used to be.
 *
 * The still is drawn, not a picture of a map, and SAYS so: the button
 * reads "Tap to load map" and a line on the still names it a preview, so
 * the street grid is never taken for the real thing. A screenshot of the
 * listing is coming from the owner to replace the drawing; it goes in as
 * the .map-facade background and nothing else changes. It keeps the
 * frame's footprint, so nothing moves when the live map replaces it.
 */
export default function MapFacade({ src, title, label, note, address }: MapFacadeProps) {
  const [live, setLive] = useState(false);

  if (live) {
    return (
      <iframe
        title={title}
        src={src}
        className="h-full w-full border-0"
        referrerPolicy="no-referrer-when-downgrade"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setLive(true)}
      aria-label={`${label}: ${address}`}
      className="map-facade group relative flex h-full w-full items-center justify-center"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 bg-ink/75 px-3 py-1.5 text-center text-xs text-ivory/80"
      >
        {note}
      </span>
      <span className="token-colors inline-flex min-h-11 items-center gap-2 rounded-lg border border-gold/60 bg-ink/80 px-5 py-2 text-sm font-semibold text-gold-light group-hover:border-gold group-hover:bg-gold group-hover:text-ink">
        {/* A map pin, drawn inline so the still needs no asset. */}
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
        </svg>
        {label}
      </span>
    </button>
  );
}
