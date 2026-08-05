/**
 * The hero's media, named once.
 *
 * Three files need these URLs and they must not drift: HeroVideo mounts
 * the element, LoadingOverlay gates its curtain on the poster having
 * decoded, and app/page.tsx emits the <link rel="preload"> that gets the
 * poster into the FIRST network flight. The poster path in particular
 * used to be a bare string literal in two of those three, which is one
 * rename away from a preload that warms a URL nobody requests.
 */

/**
 * WHERE THE FOOTAGE LIVES, AND WHY IT MOVED.
 *
 * It was served from `pub-364f647b29874b09922e1889f267c323.r2.dev`, the
 * bucket's development URL. Measured on production, that was 5,525,614
 * bytes with NO Cache-Control header at all — 5.4 MiB, re-downloaded in
 * full on every visit, and the single largest thing on a 7,954 KiB page.
 *
 * Two separate faults, and the domain was the worse one. r2.dev is
 * rate-limited, is not on our zone, and cannot be given cache headers;
 * docs/DEPLOY_RUNBOOK.md already says in as many words not to enable it,
 * for the print-jobs bucket, for exactly these reasons. This is the same
 * mistake in the other bucket.
 *
 * So the footage is now an R2 object on our own zone, served with
 * `public, max-age=31536000, immutable` set as object metadata at upload
 * time. R2 ignores public/_headers — a custom-domain object serves the
 * cacheControl it was written with — so the header lives in the upload
 * command; see docs/DEPLOY_RUNBOOK.md.
 */
export const HERO_MEDIA_ORIGIN = "https://media.newmandarincantonii.com";

/**
 * ⚠️ THE HASH IN THESE NAMES IS LOAD-BEARING, not decoration.
 *
 * `immutable` is a promise that the bytes at a URL will never change,
 * and a year is a long time to be wrong. The names carry the first 8
 * hex of each file's sha256, so a re-encode cannot reuse a URL even by
 * accident — the honest version of the header rather than a hopeful one.
 *
 * To change the footage: encode, re-hash, upload under the new name,
 * update these two lines. Do not overwrite an object.
 *
 * WEBM FIRST, AND THE ORDER IS THE WHOLE POINT. A browser takes the
 * first <source> whose type it can play, so VP9 goes to Chrome, Edge,
 * Firefox and Android — the large majority — and h264 is what Safari
 * and iOS fall to. Re-encoded from the 1920x1080 24fps master:
 *
 *   vp9  crf 40   1,898,611 bytes   (was 5,525,614 — down 66%)
 *   h264 crf 30   2,553,620 bytes   (down 54%)
 *
 * The mp4 is deliberately the roomier of the two: fewer visitors reach
 * it, so it spends its extra bytes where they cost least. Both were
 * checked frame-by-frame against the master at the held-plate and
 * wok-flare moments, not just by VMAF — VMAF flatters x264 here because
 * the master is itself h264 and x264 re-describes its own artifacts
 * cheaply, which made the webm look 15 points worse than it looks.
 */
export const HERO_SOURCES: ReadonlyArray<{ src: string; type: string }> = [
  { src: `${HERO_MEDIA_ORIGIN}/newmandarin-hero.46c01c36.webm`, type: "video/webm" },
  { src: `${HERO_MEDIA_ORIGIN}/newmandarin-hero.b11879a5.mp4`, type: "video/mp4" },
];

/**
 * The held-plate still: poster, reduced-motion hero, and load fallback.
 *
 * NOT frame 0 — it is t=9.8, the finished dish. See the long note in
 * HeroVideo.tsx for why the poster-to-video handoff is given up for it.
 *
 * Served from /public, and the LCP element of the whole site: the hero
 * paints it as a background-image on .hero-kenburns. It is covered in
 * public/_headers by the same year-long immutable rule as /images/*,
 * under the rename-on-change convention src/data/images.ts documents.
 */
export const HERO_POSTER = "/hero-poster-plate.jpg";
