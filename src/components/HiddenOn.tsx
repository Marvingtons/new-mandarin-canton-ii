"use client";

import { usePathname } from "next/navigation";

/**
 * Renders its children everywhere except the listed paths.
 *
 * For the parts of the root layout that a page repeats on its own: the
 * footer's Hours and Find Us columns are the whole of /contact, so on that
 * page they were the same headings, the same table and a second live map
 * one scroll apart. usePathname is answered on the server too, so the
 * columns are absent from the HTML rather than removed after hydration.
 */
export default function HiddenOn({
  paths,
  children,
}: {
  paths: string[];
  children: React.ReactNode;
}) {
  return paths.includes(usePathname()) ? null : children;
}
