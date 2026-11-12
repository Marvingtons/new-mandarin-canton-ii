"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/app/[kitchenSlug]/actions";
import { useKT } from "@/components/kitchen/KitchenI18n";
import Button from "@/components/kitchen/ui/Button";
import ui from "@/components/kitchen/ui/ui.module.css";

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
      <div className={`${ui.card} p-6 shadow-staff-raised`}>
        <h1 className="text-staff-heading font-bold">{t("login.title")}</h1>
        <p className="mt-1 text-staff-body text-staff-soft">{t("login.staffOnly")}</p>

        <form action={formAction} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-staff-body font-medium text-staff-soft">{t("login.password")}</span>
            <input
              type="password"
              name="password"
              required
              autoFocus
              autoComplete="current-password"
              className="min-h-14 w-full rounded-staff-control bg-staff-panel px-3 text-staff-title shadow-[inset_0_0_0_1px_var(--color-staff-line-strong)] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-staff-brand)]"
            />
          </label>

          {state.error && (
            <p role="alert" className="rounded-staff-control bg-staff-brand-tint px-3 py-2 text-staff-body font-medium text-staff-brand">
              {t("login.badPassword")}
            </p>
          )}

          <Button type="submit" variant="primary" block busy={pending} disabled={pending}>
            {pending ? t("common.busy") : t("login.submit")}
          </Button>
        </form>
      </div>
    </main>
  );
}
