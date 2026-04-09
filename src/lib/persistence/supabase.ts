import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Add it to .env.local (see docs/master_execution_plan.md).`,
    );
  }
  return value;
}

let _admin: SupabaseClient | null = null;

/**
 * Server-only Supabase client using the service role key.
 * Single-tenant, no RLS — used for all server-side DB operations.
 * Lazily initialized on first access so env vars are only required
 * when the client is actually used (not at module load time).
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;

  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  _admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  return _admin;
}
