import type { Metadata } from "next";
import { Playfair_Display, Lora, Noto_Serif_TC } from "next/font/google";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
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
    "Traditional Cantonese & Mandarin Chinese restaurant in Chula Vista, CA. Open 7 days at 543 Telegraph Canyon Rd — call (619) 656-6888.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${lora.variable} ${notoSerifTC.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-body">
        <SmoothScroll />
        <LoadingOverlay />
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        {/* Clearance so the fixed mobile bar never covers page footers. */}
        <div aria-hidden="true" className="h-14 sm:hidden" />
        <StickyOrderBar />
      </body>
    </html>
  );
}
