import type { Metadata } from "next";
import { Playfair_Display, Lora, Noto_Serif_TC } from "next/font/google";
import Header from "@/components/Header";
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
  title: {
    default: "New Mandarin Canton II | Chinese Restaurant in Chula Vista, CA",
    template: "%s | New Mandarin Canton II",
  },
  description:
    "Mandarin & Cantonese restaurant in Chula Vista, CA. Takeout pickup only — no delivery. Open 7 days at 543 Telegraph Canyon Rd — call (619) 656-6888 or (619) 656-6787.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // No `h-full` on <html>: pinning the root to the viewport height freezes its
  // box, so the ResizeObserver Lenis keeps on <html> never fires when a route's
  // content grows — Lenis then holds the previous page's scroll limit and the
  // page stops scrolling partway down. Body carries the full-viewport minimum
  // instead (min-h-dvh), which the sticky footer needs.
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${lora.variable} ${notoSerifTC.variable} antialiased`}
    >
      <body className="flex min-h-dvh flex-col font-body">
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
      </body>
    </html>
  );
}
