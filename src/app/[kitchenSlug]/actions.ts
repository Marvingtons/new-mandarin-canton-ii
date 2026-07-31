"use server";

import { revalidatePath } from "next/cache";
import {
  clearKitchenCookie,
  login,
  loginFailureDelay,
  setKitchenCookie,
} from "@/lib/auth/kitchenSession";
// The board's path is configured, never written out — see lib/kitchenRoute.
import { kitchenPath } from "@/lib/kitchenRoute";

/**
 * Login / logout for the kitchen board.
 *
 * A Server Action rather than a route handler so the password travels in a
 * POST body and never in a URL, query string, or referrer.
 */

export interface LoginState {
  error: string | null;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const submitted = String(formData.get("password") ?? "");

  const token = login(submitted);
  if (!token) {
    await loginFailureDelay();
    // One message for both "wrong password" and "not configured": an
    // unauthenticated caller learns nothing about which it was.
    return { error: "Incorrect password. · 密碼不正確。" };
  }

  await setKitchenCookie(token);
  revalidatePath(kitchenPath());
  return { error: null };
}

export async function logoutAction(): Promise<void> {
  await clearKitchenCookie();
  revalidatePath(kitchenPath());
}
