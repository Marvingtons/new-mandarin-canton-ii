import Link from "next/link";
import { orderTarget } from "@/data/order";

/**
 * The site's single "Order Takeout" control. Its destination is decided
 * entirely by `orderTarget()` (see src/data/order.ts), so every caller — hero,
 * sticky mobile bar — reuses this and changing where ordering lives never
 * touches a caller.
 *
 * Styling is fully delegated via `className` so it can be a big gold hero
 * button or a flat bar segment without variants baked in here.
 */
interface OrderTakeoutProps {
  className?: string;
  children?: React.ReactNode;
}

export default function OrderTakeout({
  className = "",
  children = "Order Takeout",
}: OrderTakeoutProps) {
  return (
    <Link href={orderTarget().href} className={className}>
      {children}
    </Link>
  );
}
