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
 * lib/hours). Client-only: renders nothing on the server and pops in
 * after mount, so there is never a wrong-state hydration flash.
 * Refreshes each minute.
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

  if (!status) return null;

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

  // Two whole strings rather than one string plus overrides: conflicting
  // Tailwind utilities on the same element resolve by their order in the
  // generated sheet, not by their order here, so `px-3 … px-2.5` is a
  // coin flip. Only one of these ever reaches the element.
  const box = compactOnMobile
    ? "gap-1.5 px-2.5 py-1 text-[11px] tracking-[0.12em] sm:gap-2 sm:px-3 sm:py-1.5 sm:text-xs sm:tracking-[0.15em]"
    : "gap-2 px-3 py-1.5 text-xs tracking-[0.15em]";

  return (
    <span
      className={`inline-flex items-center rounded-full border uppercase ${box} ${surface} ${className}`}
    >
      <span aria-hidden="true" className={`chip-dot h-1.5 w-1.5 rounded-full ${dot}`} />
      {text}
    </span>
  );
}
