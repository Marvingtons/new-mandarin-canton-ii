"use client";

import ui from "@/components/kitchen/ui/ui.module.css";

/**
 * A row of mutually exclusive choices (station filter, status filter, service
 * mode). The chosen one is filled lacquer, so the current filter is obvious
 * from across the counter, and it says so to a screen reader (aria-pressed).
 */
export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** A count shown beside the label: how many orders this choice would show. */
  count?: number;
  /** Accessible name when the label is not plain text. */
  ariaLabel?: string;
}

export default function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className = "",
}: {
  /** Names the group for assistive tech. */
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`${ui.seg} ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          aria-label={o.ariaLabel}
          data-value={o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <span className={ui.count}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
