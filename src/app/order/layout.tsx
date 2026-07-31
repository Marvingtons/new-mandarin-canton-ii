import { getMenu } from "@/lib/menu/source";
import { CartProvider } from "@/lib/cart/CartContext";
import TestModeBadge from "@/components/TestModeBadge";

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
  return (
    <CartProvider menu={menu}>
      {children}
      {/* Server-rendered from the httpOnly cookie, so it cannot be faked or
          dismissed from the page. Covers /order and /order/checkout — the two
          places a bypassed order can actually be placed. */}
      <TestModeBadge />
    </CartProvider>
  );
}
