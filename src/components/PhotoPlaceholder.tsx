import Seal from "@/components/Seal";

interface PhotoPlaceholderProps {
  /** Rendered height of the ghosted seal. */
  sealSize?: number;
}

/**
 * The site's ONE photo placeholder: warm paper, the red paper texture
 * desaturated down to grain, and the 富源 seal ghosted almost to nothing.
 *
 * This is one of the seal's two sanctioned appearances — the placeholder
 * watermark; the other is the divider ornament (see GoldDivider). It used
 * to have a rival: House Favorites drew its own solid dish-tone panel
 * with a "PHOTO" label, so an empty dish slot and an empty room slot were
 * two different-looking gaps. Now they are the same object.
 *
 * Fills its positioned parent.
 */
export default function PhotoPlaceholder({
  sealSize = 88,
}: PhotoPlaceholderProps) {
  return (
    <>
      <div className="absolute inset-0 bg-paper" />
      {/* the red paper texture, desaturated, doubles as grain */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-15 grayscale mix-blend-multiply"
        style={{
          backgroundImage: "url('/bg-red.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center"
      >
        <div className="pf-ghost">
          <Seal size={sealSize} className="opacity-[0.06]" />
        </div>
      </div>
    </>
  );
}
