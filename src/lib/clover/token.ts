import "server-only";

import { cloverFetch, CloverApiError } from "@/lib/clover/client";
import { restBase } from "@/lib/clover/env";
import type { CloverAccessTokenInfo } from "@/lib/clover/rawTypes";

/**
 * Token permission inspector.
 *
 * Clover NEVER returns 403 — an invalid token and a token that simply lacks a
 * permission both come back as 401. That ambiguity is why this exists: it lets
 * us tell the operator *which* of the two is wrong instead of guessing, and it
 * powers the Phase 3 STOP gate ("does this token carry the charge permission?").
 *
 * SECURITY: Clover's inspector endpoint takes the token in the URL PATH. That
 * is exactly the shape that leaks into logs, proxies, and thrown fetch errors,
 * so every call here passes `redactPath` — the token value can never appear in
 * an error message or a log line originating from this module.
 */

/** Permission required to read the menu. */
export const INVENTORY_READ = "INVENTORY_R";

const REDACTED_PATH = "/v3/access_tokens/***";

export interface TokenInspection {
  ok: boolean;
  permissions: string[];
  /** Set when the token is outright rejected. */
  error: string | null;
}

function extractPermissions(info: CloverAccessTokenInfo): string[] {
  if (Array.isArray(info.permissions)) {
    return info.permissions.filter((p): p is string => typeof p === "string");
  }
  // Some Clover responses shape permissions as an object map of name -> bool.
  const maybeMap = info.permissions as unknown;
  if (maybeMap && typeof maybeMap === "object") {
    return Object.entries(maybeMap as Record<string, unknown>)
      .filter(([, v]) => v === true)
      .map(([k]) => k);
  }
  return [];
}

/**
 * Ask Clover what a token is allowed to do. Never throws for auth problems —
 * returns ok:false so callers can render an actionable operator message.
 */
export async function inspectToken(token: string): Promise<TokenInspection> {
  try {
    const info = await cloverFetch<CloverAccessTokenInfo>({
      baseUrl: restBase(),
      // The token in the path is the endpoint's contract; the redactPath below
      // guarantees it never reaches a log or an error string.
      path: `/v3/access_tokens/${encodeURIComponent(token)}`,
      redactPath: REDACTED_PATH,
      token,
      method: "POST",
      maxAttempts: 2,
    });
    return { ok: true, permissions: extractPermissions(info), error: null };
  } catch (err) {
    if (err instanceof CloverApiError) {
      return {
        ok: false,
        permissions: [],
        error: err.isAuthOrPermission
          ? "Clover rejected the token (401). The token is invalid, expired, or lacks the required permission — Clover cannot distinguish these."
          : `Clover token inspection failed with status ${err.status}.`,
      };
    }
    return { ok: false, permissions: [], error: "Token inspection failed." };
  }
}

/**
 * True when the token carries `permission`. Used by /api/health and by the
 * Phase 3 STOP gate before any charge code is built against this token.
 */
export async function tokenHasPermission(
  token: string,
  permission: string,
): Promise<{ granted: boolean; detail: string }> {
  const result = await inspectToken(token);
  if (!result.ok) {
    return { granted: false, detail: result.error ?? "token rejected" };
  }
  const granted = result.permissions.includes(permission);
  return {
    granted,
    detail: granted
      ? `Token carries ${permission}.`
      : `Token is valid but does NOT carry ${permission}. Grant it in the Clover Dashboard (API Tokens) and retry.`,
  };
}
