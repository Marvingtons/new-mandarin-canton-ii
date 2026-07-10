import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Apple touch icon: the full seal mark on a solid lacquer tile
 * (iOS composites transparency onto black, so the tile is opaque).
 */
export default async function AppleIcon() {
  const svg = await readFile(
    join(process.cwd(), "public/brand/fu-yuan-seal.svg"),
    "utf8",
  );
  // base64 via Buffer — see icon.tsx (non-Latin1 chars break btoa)
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // keep in sync with --lacquer (globals.css)
          background: "#96261c",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori element, not DOM */}
        <img src={src} width={85} height={150} alt="" />
      </div>
    ),
    size,
  );
}
