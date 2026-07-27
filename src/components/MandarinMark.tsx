interface MandarinMarkProps {
  /** Rendered size in px (square). */
  size?: number;
  className?: string;
}

/**
 * 橘 — the mandarin, drawn as a gold hairline.
 *
 * Oranges are what the family lays on the altar for a prosperous year,
 * and 富源 means "source of fortune" — so this is the name's meaning as
 * a mark. Kept to a single stroke weight and a geometric silhouette:
 * the moment it gains fill, shading, or a cute face it stops being a
 * motif and becomes a sticker.
 *
 * Inherits `currentColor`, so colour is the caller's business.
 */
export default function MandarinMark({
  size = 16,
  className = "",
}: MandarinMarkProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* the fruit */}
      <circle cx="12" cy="14.6" r="6.9" />
      {/* stem */}
      <path d="M12 7.7V6.2" />
      {/* one leaf, lifted to the right so the mark reads asymmetrically */}
      <path d="M12.7 6.9c1.3-1.9 3.6-2.4 5-2.1.1 1.7-1.2 3.6-3.1 4-1.1.2-2-.7-1.9-1.9z" />
    </svg>
  );
}
