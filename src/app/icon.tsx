import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/**
 * 32px favicon from the official seal mark. The full frame + both
 * characters turn to mud at this size, so the viewBox is cropped to
 * the small-size variant (富 alone) — same crop Seal.tsx uses below
 * 32px — on a lacquer tile for visibility on any tab background.
 */
export default async function Icon() {
  const svg = await readFile(
    join(process.cwd(), "public/brand/fu-yuan-seal.svg"),
    "utf8",
  );
  const smallVariant = svg.replace(
    /viewBox="[^"]*"/,
    'viewBox="46.3 17.9 52.4 59.5"',
  );
  // base64 via Buffer: the file contains non-Latin1 characters (富源 in
  // a comment), which break next/og's internal btoa on plain data URIs.
  const src = `data:image/svg+xml;base64,${Buffer.from(smallVariant).toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // keep in sync with --lacquer (globals.css) — Satori can't
          // read CSS variables at build time
          background: "#96261c",
          borderRadius: 6,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori element, not DOM */}
        <img src={src} width={24} height={27} alt="" />
      </div>
    ),
    size,
  );
}
