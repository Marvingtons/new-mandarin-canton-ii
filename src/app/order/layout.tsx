import { getMenu } from "@/lib/menu/source";
import { CartProvider } from "@/lib/cart/CartContext";

/**
 * Order flow layout. Fetches the menu once (cached) and provides the cart
 * context to both /order and /order/checkout, so a cart survives the
 * navigation between browsing and paying.
 */
export default async function OrderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const menu = await getMenu();
  return <CartProvider menu={menu}>{children}</CartProvider>;
}
