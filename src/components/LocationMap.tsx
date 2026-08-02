import {
  directionsUrl,
  fullAddress,
  mapEmbedUrl,
  restaurant,
} from "@/data/restaurant";
import { getT } from "@/lib/i18n/server";

interface LocationMapProps {
  /** Aspect ratio of the framed map. */
  aspect?: string;
  /** "dark" for the lacquer footer, "light" for paper pages. */
  tone?: "dark" | "light";
  /**
   * Print the "Get Directions" link under the map. Off in the footer,
   * where the contact band directly above already carries it — two of
   * them in one viewport is the redundancy, not the reassurance.
   */
  showDirections?: boolean;
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
export default async function LocationMap({
  aspect = "16/9",
  tone = "dark",
  showDirections = true,
  className = "",
}: LocationMapProps) {
  const t = await getT();
  const link =
    tone === "dark"
      ? "text-gold-light hover:text-gold"
      : "text-lacquer hover:text-lacquer-dark";

  return (
    <div className={className}>
      {/* The site frame, same as the photo frames. This used to draw its
          own gold/50 border with an outward gold/20 halo and a rounded
          corner — rejected at the time as the only rounded frame on the
          site. The corner is back, but as a system value: .frame carries
          --radius-md and clips the iframe to it, so every framed thing
          rounds together and none of them decides on its own. */}
      <div className="frame">
        <div className="overflow-hidden" style={{ aspectRatio: aspect }}>
          <iframe
            title={`Map to ${restaurant.name}, ${fullAddress}`}
            src={mapEmbedUrl}
            className="h-full w-full border-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </div>
      {showDirections && (
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener"
          /* 117x20 under the map on /contact — the last sub-44px control
             on the marketing pages. `tap` takes the target to 44 and
             leaves the line where it is. */
          className={`arrow-link tap token-colors mt-3 inline-block text-sm font-semibold underline decoration-gold/60 underline-offset-4 ${link}`}
        >
          {t("footer.getDirections")} <span className="arrow">→</span>
        </a>
      )}
    </div>
  );
}
