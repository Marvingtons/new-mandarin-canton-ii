import type { Metadata } from "next";
import { getMenu } from "@/lib/menu/source";
import { publicTenant } from "@/config/tenant.server";
import OrderMenu from "@/components/order/OrderMenu";

export const metadata: Metadata = {
  title: "Order Pickup",
  description:
    "Order pickup direct from New Mandarin Canton II in Chula Vista — no delivery-app fees. Add items to your cart and pay online for pickup.",
};

/**
 * Online PICKUP ordering. Browse → cart → checkout, all pickup-only. The menu
 * comes from getMenu() (seed today, Clover once synced); the cart lives in the
 * client CartProvider from the order layout.
 */
export default async function OrderPage() {
  const menu = await getMenu();
  const tenant = publicTenant();
  return (
    <OrderMenu
      menu={menu}
      taxRateBps={tenant.taxRateBps}
      menuSource={menu.source}
    />
  );
}
