/**
 * The staff area's icons. One drawing convention (24px grid, 2px round
 * stroke, no fill), so they sit together; replaces the emoji the board used
 * to lean on, which render differently on every tablet. Decorative by
 * default: the control around an icon carries the accessible name.
 * `size` is in spec pixels, the staff app's one unit; see the style below.
 */

const PATHS = {
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
  bellOff:
    "M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7M10.3 21a1.94 1.94 0 0 0 3.4 0M2 2l20 20",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  x: "M18 6 6 18M6 6l12 12",
  minus: "M5 12h14",
  plus: "M12 5v14M5 12h14",
  printer: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z",
  phone:
    "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z",
  store: "M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6",
  globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
  alert: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  check: "M20 6 9 17l-5-5",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  chevronLeft: "M15 18l-6-6 6-6",
  chevronRight: "M9 18l6-6-6-6",
  logOut: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  receipt: "M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1zM8 7h8M8 11h8M8 15h5",
  repeat: "M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  dot: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  /** An empty circle, so a state is a shape and not only a colour. */
  circle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  chevronDown: "M6 9l6 6 6-6",
  type: "M4 7V4h16v3M9 20h6M12 4v16",
  more: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  /** The board: order columns. */
  columns: "M3 4h7v16H3zM14 4h7v16h-7z",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  note: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5",
  // The POS tabs (lib/kitchen/posCategories.ts).
  star: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z",
  flame:
    "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z",
  layers: "M12 2L2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  drumstick: "M15 15a6 6 0 1 0-6-6c0 2 1 3 1 3l-4.5 4.5a2 2 0 1 0 2 2L12 14s1 1 3 1z",
  steak: "M4 13c0-5 4-9 9-9s7 3 7 6-2 4-4 5-3 5-7 5-5-3-5-7zM12 10.5h.01",
  fish: "M6.5 12C7.4 8.5 11.4 6 15 6s6 2.5 7 6c-1 3.5-3.4 6-7 6s-7.6-2.5-8.5-6zM18 12h.01M7 10.7C7 8 5.6 6 2.7 5.5c-1 1.5-1 5 .2 6.5-1.2 1.5-1.2 5-.2 6.5C5.6 18 7 16 7 13.3",
  leaf: "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10zM2 21c0-3 1.9-5.4 5.1-6 2.4-.5 4.9-2 5.9-3",
  bowl: "M3 11h18a9 9 0 0 1-18 0zM8 8c0-2 2-2 2-4M13 8c0-2 2-2 2-4",
  soup: "M4 10h14v4a6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6zM18 11h1a2 2 0 0 1 0 4h-1M9 3v4M13 3v4",
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({
  name,
  size = 20,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      // In spec pixels, like every other staff size: 1rem is 22 of them on
      // the staff surface, so size={20} is 20px, and grows with 大字 like the
      // text beside it (globals.css, STAFF TYPE SCALE).
      style={{ width: `${size / 22}rem`, height: `${size / 22}rem` }}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
