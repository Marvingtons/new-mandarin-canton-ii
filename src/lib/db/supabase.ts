import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/config/tenant.server";

/**
 * Server-only Supabase client.
 *
 * Uses the SERVICE ROLE key, which bypasses Row Level Security. That is the
 * correct choice here because every write is server-authoritative (the browser
 * never talks to the database — it talks to our route handlers, which validate
 * and recompute first). It also makes the `import "server-only"` guard above
 * non-negotiable: this key must never be bundled for the client.
 *
 * We use the PostgREST/HTTP client rather than a direct Postgres socket so
 * serverless functions cannot exhaust the connection pool.
 */

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const { url, serviceRoleKey } = supabaseConfig();
  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** True when Supabase is configured at all — lets callers degrade gracefully. */
export function isDbConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
