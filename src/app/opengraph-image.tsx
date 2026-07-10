import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt =
  "New Mandarin Canton II — 富源 — Chinese Restaurant in Chula Vista, CA";

/**
 * Social share card: the official seal mark centered on the textured
 * lacquer field. Purely graphic (no text) so no font loading is
 * needed in the Satori render.
 */
export default async function OpengraphImage() {
  const [svg, texture] = await Promise.all([
    readFile(join(process.cwd(), "public/brand/fu-yuan-seal.svg"), "utf8"),
    readFile(join(process.cwd(), "public/bg-red.jpg")),
  ]);
  // base64 via Buffer — see icon.tsx (non-Latin1 chars break btoa)
  const mark = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const field = `data:image/jpeg;base64,${texture.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#a5160f",
          backgroundImage: `url(${field})`,
          backgroundSize: "1200px 675px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori element, not DOM */}
        <img src={mark} width={289} height={512} alt="" />
      </div>
    ),
    size,
  );
}
