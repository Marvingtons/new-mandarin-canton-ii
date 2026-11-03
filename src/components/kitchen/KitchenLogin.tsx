"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/app/[kitchenSlug]/actions";
import { useKT } from "@/components/kitchen/KitchenI18n";

/**
 * Staff login. The password is submitted as a POST body to a Server Action, so
 * it never appears in a URL, a query string, or a referrer header.
 *
 * Large touch targets throughout — this is typed on a counter tablet, often
 * one-handed, sometimes with wet hands.
 */
export default function KitchenLogin() {
  const t = useKT();
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    { error: null },
  );

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center px-6">
      <div className="rounded-lg border border-staff-line bg-staff-panel p-6 shadow-[0_8px_24px_-12px_rgba(27,26,23,0.18)]">
        <h1 className="text-2xl font-semibold">{t("login.title")}</h1>
        <p className="mt-1 text-base text-staff-faint">{t("login.staffOnly")}</p>

        <form action={formAction} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-base font-medium text-staff-soft">{t("login.password")}</span>
            <input
              type="password"
              name="password"
              required
              autoFocus
              autoComplete="current-password"
              className="min-h-12 w-full rounded-md border border-staff-line-strong bg-staff-panel px-3 text-lg outline-none focus:border-staff-accent"
            />
          </label>

          {state.error && (
            <p role="alert" className="rounded-md bg-staff-danger-tint px-3 py-2 text-base font-medium text-staff-danger">
              {t("login.badPassword")}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="min-h-12 rounded-md bg-staff-accent text-lg font-semibold text-white transition-colors hover:bg-staff-accent-hover disabled:opacity-50"
          >
            {pending ? t("common.busy") : t("login.submit")}
          </button>
        </form>
      </div>
    </main>
  );
}
