"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/LocaleContext";
import { openStatus } from "@/lib/hours";
import type { OpenStatus } from "@/lib/hours";

interface OpenNowChipProps {
  /** "dark" for lacquer/ink surfaces, "light" for paper/cream. */
  tone?: "dark" | "light";
  /**
   * One size step down BELOW `sm` only, for the hero's mobile caption
   * block — where the chip is the quietest thing in a stack that also
   * holds two full-width buttons and a call row, and at full size read
   * as a fourth control rather than as the note it is.
   *
   * The step is box-first: padding, gap and tracking come in, and the
   * type goes 12px → 11px, which is the site's existing micro-caps floor
   * (the language pill in the header is 11px). It is not a new size.
   * From `sm` up this is byte-for-byte the default chip, so the footer
   * band and /contact are untouched.
   */
  compactOnMobile?: boolean;
  className?: string;
}

/**
 * Live open/closed status, computed in the restaurant's timezone (see
 * lib/hours). Client-only: the server renders a same-height placeholder
 * rather than the chip, so there is never a wrong-state hydration flash
 * and never a layout shift when the real one arrives. Refreshes each
 * minute.
 */
export default function OpenNowChip({
  tone = "dark",
  compactOnMobile = false,
  className = "",
}: OpenNowChipProps) {
  const t = useT();
  const [status, setStatus] = useState<OpenStatus | null>(null);

  useEffect(() => {
    const tick = () => setStatus(openStatus());
    const t = setTimeout(tick, 0);
    const interval = setInterval(tick, 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(interval);
    };
  }, []);

  // Two whole strings rather than one string plus overrides: conflicting
  // Tailwind utilities on the same element resolve by their order in the
  // generated sheet, not by their order here, so `px-3 … px-2.5` is a
  // coin flip. Only one of these ever reaches the element.
  const box = compactOnMobile
    ? "gap-1.5 px-2.5 py-1 text-[11px] tracking-[0.12em] sm:gap-2 sm:px-3 sm:py-1.5 sm:text-xs sm:tracking-[0.15em]"
    : "gap-2 px-3 py-1.5 text-xs tracking-[0.15em]";

  // NOT `null`, and this is a measured fix rather than tidiness.
  //
  // This chip is client-only, so the server renders nothing and the real
  // chip appears a frame after mount. In the hero — a bottom-anchored
  // absolute block — that insertion pushes EVERYTHING above it upward,
  // and Lighthouse mobile attributed the homepage's entire CLS to that
  // one shift: 0.019 with the old stacked hero, 0.029 once the CTAs went
  // full-width and there was more block above the chip to move.
  //
  // A same-height placeholder holds the line open so nothing moves. Its
  // width is still wrong until the status resolves, but a chip settling
  // sideways is one 27px-tall element; the shift this replaces was 455px
  // of hero copy. Transparent, empty, and aria-hidden: it is space, not
  // a state, and it must never announce a status it does not have.
  if (!status)
    return (
      <span
        aria-hidden="true"
        className={`inline-flex items-center rounded-full border border-transparent uppercase ${box} ${className}`}
      >
        {/* The dot's box, then a NON-BREAKING space — not a plain one.
            A whitespace-only text run between flex items is not rendered
            at all, so a plain space would build no line box and the
            placeholder would come out ~10px short of the chip it stands
            in for: a smaller shift, not no shift. U+00A0 is not
            collapsible white space, so it becomes a real flex item one
            line box tall, which is exactly what the label gives. */}
        <span className="h-1.5 w-1.5" />
        {" "}
      </span>
    );

  const surface =
    tone === "light"
      ? "border-gold/40 bg-cream text-ink/80"
      : "border-ivory/30 bg-ink/40 text-ivory";
  const dot = status.open
    ? "bg-gold"
    : tone === "light"
      ? "bg-ink/30"
      : "bg-ivory/40";

  // `openStatus` hands back one pre-formatted English sentence, and it is
  // shared with callers this component does not own, so the sentence has
  // to be rebuilt here rather than there. The clock time is the only part
  // that must survive translation intact; the dictionary supplies the
  // wording around it. In English the result is byte-for-byte the string
  // lib/hours already produced. If that shape ever changes, the label as
  // given is rendered rather than a half-built sentence.
  const time = /(\d{1,2}:\d{2}\s*(?:AM|PM))\s*$/i.exec(status.label)?.[1];
  const text = time
    ? t(status.open ? "chip.openUntil" : "chip.closedOpensAt", { time })
    : status.label;

  return (
    <span
      className={`inline-flex items-center rounded-full border uppercase ${box} ${surface} ${className}`}
    >
      <span aria-hidden="true" className={`chip-dot h-1.5 w-1.5 rounded-full ${dot}`} />
      {text}
    </span>
  );
}
