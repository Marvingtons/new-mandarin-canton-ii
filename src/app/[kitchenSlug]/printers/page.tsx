import type { Metadata } from "next";
import { KitchenFrame, kitchenGuard, kitchenMetadata } from "@/components/kitchen/KitchenGuard";
import PrinterAdmin from "@/components/kitchen/PrinterAdmin";

/**
 * /{kitchen}/printers: the printers (migration 011). Status for anyone with
 * the kitchen session; changes need the owner PIN, checked by the API on
 * every request. Behind the same guard as the board.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ kitchenSlug: string }>;
}): Promise<Metadata> {
  return kitchenMetadata((await params).kitchenSlug);
}

export default async function KitchenPrintersPage({
  params,
}: {
  params: Promise<{ kitchenSlug: string }>;
}) {
  const guard = await kitchenGuard((await params).kitchenSlug);
  if (!guard.ok) return guard.node;

  return (
    <KitchenFrame lang={guard.lang} basePath={guard.basePath} active="printers">
      <PrinterAdmin />
    </KitchenFrame>
  );
}
