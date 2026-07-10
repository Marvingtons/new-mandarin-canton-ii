"use client";

import { useEffect, useState } from "react";
import { restaurant } from "@/data/restaurant";
import type { DayOfWeek } from "@/data/restaurant";

/** Index matches Date.prototype.getDay() (0 = Sunday). */
const byJsDay: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function toMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t.trim());
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h * 60 + parseInt(m[2], 10);
}

type Status = { open: boolean; label: string };

function computeStatus(now: Date): Status | null {
  const today = restaurant.hours[byJsDay[now.getDay()]];
  const open = toMinutes(today.open);
  const close = toMinutes(today.close);
  if (open === null || close === null) return null;
  const mins = now.getHours() * 60 + now.getMinutes();
  if (!today.closed && mins >= open && mins < close)
    return { open: true, label: `Open now · until ${today.close}` };
  if (!today.closed && mins < open)
    return { open: false, label: `Closed · opens ${today.open}` };
  const tomorrow = restaurant.hours[byJsDay[(now.getDay() + 1) % 7]];
  return { open: false, label: `Closed · opens ${tomorrow.open}` };
}

interface OpenNowChipProps {
  className?: string;
}

/**
 * Live open/closed status from the hours data. Client-only: renders
 * nothing on the server and pops in after mount, so there is never a
 * wrong-state hydration flash. Refreshes each minute.
 */
export default function OpenNowChip({ className = "" }: OpenNowChipProps) {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    const tick = () => setStatus(computeStatus(new Date()));
    const t = setTimeout(tick, 0);
    const interval = setInterval(tick, 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(interval);
    };
  }, []);

  if (!status) return null;

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border border-ivory/30 bg-ink/40 px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.15em] text-ivory ${className}`}
    >
      <span
        aria-hidden="true"
        className={`chip-dot h-1.5 w-1.5 rounded-full ${status.open ? "bg-gold" : "bg-ivory/40"}`}
      />
      {status.label}
    </span>
  );
}
