import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Playfair_Display, Lora, Noto_Serif_TC } from "next/font/google";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import { LOCALE_COOKIE, htmlLang, toLocale } from "@/lib/i18n/locale";
import Header from "@/components/Header";
import JsonLd from "@/components/JsonLd";
import { graph, restaurantNode, websiteNode } from "@/lib/schema";
import { siteUrl } from "@/lib/siteUrl";
import Footer from "@/components/Footer";
import BackToTop from "@/components/BackToTop";
import LoadingOverlay from "@/components/LoadingOverlay";
import SmoothScroll from "@/components/SmoothScroll";
import StickyOrderBar from "@/components/StickyOrderBar";
import "./globals.css";

// Serif display face with character — headings only.
const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

// Warm, readable body face.
const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
});

// Chinese serif — bilingual section headings and Chinese dish names.
// (Traditional characters; glyph chunks load on demand via unicode-range.)
const notoSerifTC = Noto_Serif_TC({
  variable: "--font-noto-tc",
  weight: ["500", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  /* Every relative URL in every page's metadata resolves against this.
     Without it, Next builds og:image off the REQUEST host — which is
     correct in production by luck and wrong on any preview deployment,
     and which made the local og:image read http://localhost:54185/…
     Same env override as sitemap.ts and robots.ts, so the three files
     cannot disagree about what this site's address is. */
  metadataBase: new URL(siteUrl()),
  title: {
    default: "New Mandarin Canton II | Chinese Restaurant in Chula Vista, CA",
    template: "%s | New Mandarin Canton II",
  },
  /* The homepage's canonical. Every other page sets its own; none of
     them had one, so a crawler reaching /menu?utm_source=… had nothing
     telling it that was the same page as /menu. */
  alternates: { canonical: "/" },
  /* 154 characters. The one it replaces was 163 — over the ~160 a
     result snippet shows — and spent its last 44 on two phone numbers,
     so the part that got cut was the part a search result exists to
     carry. Same voice as the family's story now, and the facts are
     theirs: 1995, family-run, Chula Vista, three cuisines, pickup only.

     ⚠️ ENGLISH IN BOTH LOCALES, like every description on the site. Not
     an oversight and not fixed here: `metadata` is a static export
     evaluated outside the request, so making it locale-aware is
     `generateMetadata` on every page, which is a change to how the site
     renders rather than a change to its copy. Logged in
     docs/SITE_REVIEW_2.md under P14. */
  description:
    "Family-run Chinese restaurant in Chula Vista since 1995. Mandarin, Szechuan and Cantonese, cooked to order. Takeout pickup only, no delivery. Open 7 days.",
};

/**
 * ⚠️ READING THE LOCALE COOKIE HERE MAKES EVERY ROUTE DYNAMIC, and that
 * is a deliberate, costed trade rather than an oversight.
 *
 * `cookies()` in a layout opts the route into dynamic rendering, and
 * every route inherits this one. Before this, seven pages were
 * prerendered to static HTML — /, /about, /contact, /privacy, /terms and
 * the two error shells — and are now a Worker invocation per request.
 * /menu, /order and the order flow were already dynamic (the segment
 * layouts read the test-mode cookie), so nothing is lost there.
 *
 * The alternative was reading the cookie in a client component and
 * swapping the strings after hydration. That is cheaper and worse: the
 * first paint of every page would be English, and a Spanish speaker
 * would watch the site change language under them on every navigation.
 * `lang` on <html> would also be wrong until JavaScript ran, which is
 * the attribute a screen reader picks its voice from.
 *
 * If the static pages need to come back, the answer is `cacheComponents`
 * plus its caching model, not moving this read deeper — Header and
 * Footer both live in this layout and both need the locale.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = toLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  // No `h-full` on <html>: pinning the root to the viewport height freezes its
  // box, so the ResizeObserver Lenis keeps on <html> never fires when a route's
  // content grows — Lenis then holds the previous page's scroll limit and the
  // page stops scrolling partway down. Body carries the full-viewport minimum
  // instead (min-h-dvh), which the sticky footer needs.
  return (
    <html
      lang={htmlLang(locale)}
      className={`${playfair.variable} ${lora.variable} ${notoSerifTC.variable} antialiased`}
    >
      <body className="flex min-h-dvh flex-col font-body">
        {/* WHO THIS IS, on every page — the two nodes that never change.
            In the root layout rather than per page so a crawler that
            lands anywhere (a legal page, a 404) still resolves the
            business. Pages that have more to say add their own block:
            /menu the full menu graph, /contact the FAQ, each with its
            own breadcrumb trail. They reference these two by @id rather
            than restating them. */}
        <JsonLd data={graph(restaurantNode(), websiteNode())} />
        <LocaleProvider locale={locale}>
          <SmoothScroll />
          <LoadingOverlay />
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
          {/* Clearance so the fixed mobile bar never covers page footers. */}
          <div aria-hidden="true" className="h-14 sm:hidden" />
          <StickyOrderBar />
          {/* Bottom-right, opposite TestModeBadge. It opts itself out of the
              kitchen board by looking for [data-kitchen-surface]. */}
          <BackToTop />
        </LocaleProvider>
      </body>
    </html>
  );
}
