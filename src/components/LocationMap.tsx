import {
  directionsUrl,
  fullAddress,
  mapEmbedUrl,
  restaurant,
} from "@/data/restaurant";

interface LocationMapProps {
  /** Aspect ratio of the framed map. */
  aspect?: string;
  /** "dark" for the lacquer footer, "light" for paper pages. */
  tone?: "dark" | "light";
  className?: string;
}

/**
 * The address, framed. A keyless Google Maps embed (no API key, no
 * billing account) inside the site's gold-hairline treatment, so the
 * standard light map sits INSIDE the lacquer rather than floating on
 * top of it — the frame is what makes it feel placed.
 *
 * Server component: the iframe is lazy, so nothing loads until it is
 * near the viewport.
 */
export default function LocationMap({
  aspect = "16/9",
  tone = "dark",
  className = "",
}: LocationMapProps) {
  const link =
    tone === "dark"
      ? "text-gold-light hover:text-gold"
      : "text-lacquer hover:text-lacquer-dark";

  return (
    <div className={className}>
      <div
        className="overflow-hidden rounded-sm border border-gold/50 bg-paper outline outline-offset-2 outline-gold/20"
        style={{ aspectRatio: aspect }}
      >
        <iframe
          title={`Map to ${restaurant.name}, ${fullAddress}`}
          src={mapEmbedUrl}
          className="h-full w-full border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
      <a
        href={directionsUrl}
        target="_blank"
        rel="noopener"
        className={`arrow-link token-colors mt-3 inline-block text-sm font-semibold underline decoration-gold/60 underline-offset-4 ${link}`}
      >
        Get Directions <span className="arrow">→</span>
      </a>
    </div>
  );
}
