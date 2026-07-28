import type { Metadata } from "next";

/**
 * The kitchen board is staff-only. It must never be indexed, and it must never
 * be served from a cache — an order board showing a stale queue is worse than
 * no board at all.
 */
export const metadata: Metadata = {
  title: "Kitchen",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export const dynamic = "force-dynamic";

export default function KitchenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Covers the site chrome rather than removing it. The marketing header,
  // footer and sticky order bar live in the ROOT layout, and the only way to
  // genuinely drop them is a second root layout — which means moving every
  // marketing route into a route group. Not worth that blast radius for a
  // staff screen: a fixed, opaque, top-of-stack surface is visually identical
  // and touches nothing else.
  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-ink text-ivory">
      {children}
    </div>
  );
}
