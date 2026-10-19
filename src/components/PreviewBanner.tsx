import { headers } from "next/headers";
import { normalizeHost, orderingAllowedOn } from "@/lib/http/deployHost";
import { getT } from "@/lib/i18n/server";

/**
 * "Preview: ordering disabled", across the top of every page on a host
 * that cannot take orders (see lib/http/deployHost). The order and SMS
 * endpoints already refuse there; this is so nobody fills in a cart and
 * a phone number to find that out at the last step.
 *
 * Fixed, above everything including the intro curtain, and it pushes the
 * page and the fixed header down through --test-ribbon-h, the same
 * mechanism the test-mode ribbon uses. Production and localhost render
 * nothing.
 */
export default async function PreviewBanner() {
  const host = normalizeHost((await headers()).get("host"));
  if (orderingAllowedOn(host)) return null;
  const t = await getT();

  return (
    <>
      <style>{`:root{--test-ribbon-h:28px}`}</style>
      <div
        role="status"
        className="fixed inset-x-0 top-0 z-[220] flex h-7 items-center justify-center border-b-2 border-lacquer bg-gold px-3 text-center text-xs font-semibold uppercase tracking-[0.12em] text-ink"
      >
        {t("preview.orderingDisabled")}
      </div>
    </>
  );
}
