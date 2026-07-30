/**
 * Pre-render the favicon, apple-touch icon and social card to static PNGs.
 *
 *   npm run build:app-icons
 *
 * WHY THESE ARE FILES AND NOT ROUTES. They used to be `icon.tsx`,
 * `apple-icon.tsx` and `opengraph-image.tsx` — route handlers that read
 * public/brand/fu-yuan-seal.svg with node:fs at REQUEST time and composed it
 * through next/og. That works on Node and cannot work on workerd, which has no
 * filesystem: production answered /apple-icon with
 *
 *   no such file or directory, readAll '/bundle/public/brand/fu-yuan-seal.svg'
 *
 * Inlining the asset would have fixed the crash, but the deeper point is that
 * none of these three images depends on the request. Rendering them per-request
 * bought nothing and cost a Satori + yoga.wasm render on the edge. So they are
 * generated here, committed, and served by Next's static metadata conventions
 * (app/icon.png, app/apple-icon.png, app/opengraph-image.png).
 *
 * Re-run this when public/brand/fu-yuan-seal.svg or public/bg-red.jpg changes.
 * Nothing runs it automatically: these outputs are checked in, and a generator
 * wired into `build` would rewrite committed bytes on every CI run.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

const ROOT = process.cwd();
const APP = join(ROOT, "src", "app");

/** Lacquer. Keep in sync with --lacquer in globals.css. */
const LACQUER = "#96261c";
/** The OG field's base colour, under the texture. */
const OG_FIELD = "#a5160f";

/**
 * base64 via Buffer, not a plain data URI: the SVG carries 富源 in a comment,
 * and non-Latin1 characters break next/og's internal btoa.
 */
function dataUri(bytes: Buffer | string, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function write(name: string, response: ImageResponse): Promise<void> {
  const bytes = Buffer.from(await response.arrayBuffer());
  const out = join(APP, name);
  await writeFile(out, bytes);
  console.log(`  ${name.padEnd(22)} ${String(bytes.length).padStart(7)} bytes`);
}

async function main(): Promise<void> {
  const sealSvg = await readFile(join(ROOT, "public/brand/fu-yuan-seal.svg"), "utf8");
  const texture = await readFile(join(ROOT, "public/bg-red.jpg"));

  console.log("rendering app icons:");

  // ---- icon.png — 32px favicon ----
  // The full frame and both characters turn to mud at this size, so the
  // viewBox is cropped to the small-size variant (富 alone) — the same crop
  // Seal.tsx uses below 32px — on a lacquer tile so it reads on any tab
  // background.
  const smallVariant = sealSvg.replace(/viewBox="[^"]*"/, 'viewBox="46.3 17.9 52.4 59.5"');
  await write(
    "icon.png",
    new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: LACQUER,
            borderRadius: 6,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori element, not DOM */}
          <img src={dataUri(smallVariant, "image/svg+xml")} width={24} height={27} alt="" />
        </div>
      ),
      { width: 32, height: 32 },
    ),
  );

  // ---- apple-icon.png — 180px touch icon ----
  // Opaque tile: iOS composites transparency onto black.
  await write(
    "apple-icon.png",
    new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: LACQUER,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori element, not DOM */}
          <img src={dataUri(sealSvg, "image/svg+xml")} width={85} height={150} alt="" />
        </div>
      ),
      { width: 180, height: 180 },
    ),
  );

  // ---- opengraph-image.png — 1200x630 social card ----
  // Purely graphic, no text, so no font loading is needed in the render.
  await write(
    "opengraph-image.png",
    new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: OG_FIELD,
            backgroundImage: `url(${dataUri(texture, "image/jpeg")})`,
            backgroundSize: "1200px 675px",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori element, not DOM */}
          <img src={dataUri(sealSvg, "image/svg+xml")} width={289} height={512} alt="" />
        </div>
      ),
      { width: 1200, height: 630 },
    ),
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
