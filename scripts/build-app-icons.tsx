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
 * Re-run this when public/brand/fu-yuan-seal.svg, public/fu-yuan-logo.svg or
 * the palette in globals.css changes.
 * Nothing runs it automatically: these outputs are checked in, and a generator
 * wired into `build` would rewrite committed bytes on every CI run.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

const ROOT = process.cwd();
const APP = join(ROOT, "src", "app");

/**
 * Lacquer. Keep in sync with --lacquer in globals.css — these outputs are
 * committed bytes, so a token change here is only real once this script is
 * re-run and the PNGs are re-committed.
 */
const LACQUER = "#77151a";
/** Ink. Keep in sync with --ink in globals.css. */
const INK = "#1e1510";

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
  // bg-red.jpg used to texture the OG card's red field. The card is the
  // full lockup on flat ink now, so nothing reads that file here any more.
  const sealSvg = await readFile(join(ROOT, "public/brand/fu-yuan-seal.svg"), "utf8");

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
  //
  // THE FULL LOCKUP ON INK, not the mark on red. A share card that
  // carries no name is a nice graphic and a bad link preview, and the
  // wordmark does not have to be typeset to fix that: the official
  // artwork already contains it, as vector paths under the frame
  // (cls-4, "NEW MANDARIN CANTON II", plus the three hairlines that
  // flank it). Using fu-yuan-logo.svg rather than the fu-yuan-seal.svg
  // crop therefore gets the brand-board lockup for free and keeps this
  // render text-free, so no font has to be loaded into Satori.
  //
  // Ink ground, not lacquer: it is the same field the preloader presses
  // onto and the same one the footer sits on, and gold-on-ink is the
  // pairing this palette is strongest at (7.75:1 for the wordmark's
  // #DA9F52, 10.22:1 for the characters' #EABD62).
  const logoSvg = await readFile(join(ROOT, "public/fu-yuan-logo.svg"), "utf8");
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
            backgroundColor: INK,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori element, not DOM */}
          <img src={dataUri(logoSvg, "image/svg+xml")} width={378} height={510} alt="" />
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
