"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/LocaleContext";
import { openStatus } from "@/lib/hours";
import type { OpenStatus } from "@/lib/hours";

interface OpenNowChipProps {
  /** "dark" for lacquer/ink surfaces, "light" for paper/cream. */
  tone?: "dark" | "light";
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

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.15em] ${surface} ${className}`}
    >
      <span aria-hidden="true" className={`chip-dot h-1.5 w-1.5 rounded-full ${dot}`} />
      {text}
    </span>
  );
}
