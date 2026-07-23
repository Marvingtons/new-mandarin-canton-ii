import "server-only";

import { cloverEnv } from "@/config/tenant.server";
import type { CloverEnv } from "@/config/tenant.types";

/**
 * Clover host map.
 *
 * Clover splits across two unrelated host families, and sending a request to
 * the wrong one fails in confusing ways:
 *
 *   rest    — v3 Platform/Inventory API (menu reads)
 *   scl     — Ecommerce API (POST /v1/charges)
 *
 * Note the sandbox REST host is `apisandbox.dev.clover.com`, which is NOT the
 * developer dashboard host (`sandbox.dev.clover.com`). Mixing those up is the
 * classic first-day mistake.
 */
interface CloverHosts {
  /** v3 Platform/Inventory REST base. */
  rest: string;
  /** Ecommerce charges base (SCL). */
  scl: string;
}

const HOSTS: Record<CloverEnv, CloverHosts> = {
  sandbox: {
    rest: "https://apisandbox.dev.clover.com",
    scl: "https://scl-sandbox.dev.clover.com",
  },
  production: {
    rest: "https://api.clover.com",
    scl: "https://scl.clover.com",
  },
};

export function cloverHosts(): CloverHosts {
  return HOSTS[cloverEnv()];
}

export function restBase(): string {
  return cloverHosts().rest;
}

export function sclBase(): string {
  return cloverHosts().scl;
}
