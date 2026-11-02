import "server-only";

import { cookies } from "next/headers";
import { KITCHEN_LANG_COOKIE, toKitchenLang, type KitchenLang } from "@/lib/kitchen/i18n";

/**
 * The staff area's language for THIS request, from the cookie the toggle
 * mirrors. Read on the server so the first paint is already in the chosen
 * language: localStorage alone cannot be read until after hydration, and a
 * tablet that flashes English before switching to 中文 on every navigation is
 * exactly what the cookie exists to prevent.
 */
export async function kitchenLang(): Promise<KitchenLang> {
  const store = await cookies();
  return toKitchenLang(store.get(KITCHEN_LANG_COOKIE)?.value);
}
