"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/app/[kitchenSlug]/actions";

/**
 * Staff login. The password is submitted as a POST body to a Server Action, so
 * it never appears in a URL, a query string, or a referrer header.
 *
 * Large touch targets throughout — this is typed on a counter tablet, often
 * one-handed, sometimes with wet hands.
 */
export default function KitchenLogin() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    { error: null },
  );

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="font-display text-4xl text-gold">廚房 Kitchen</h1>
        <p className="mt-2 text-ivory/70">Staff only.</p>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-ivory/60">
            Password
          </span>
          <input
            type="password"
            name="password"
            required
            autoFocus
            autoComplete="current-password"
            className="min-h-14 w-full rounded-sm border-2 border-gold/50 bg-ink px-4 text-xl text-ivory outline-none focus:border-gold"
          />
        </label>

        {state.error && (
          <p
            role="alert"
            className="rounded-md border-2 border-lacquer bg-lacquer/20 px-4 py-3 text-base font-semibold text-ivory"
          >
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="min-h-14 rounded-lg bg-gold text-xl font-semibold text-ink transition-colors hover:bg-gold-light disabled:opacity-50"
        >
          {pending ? "…" : "登入 Sign in"}
        </button>
      </form>
    </main>
  );
}
