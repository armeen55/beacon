import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertHermeticSupabase } from "./live-db-guard";

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
 * True when both Supabase env vars are present (non-empty). Lets always-on
 * durable writers/readers short-circuit cleanly when the DB isn't configured
 * (hermetic test runs blank these), instead of attempting a round-trip that
 * throws inside `getSupabaseAdmin` and only logs a warn. Cheap to call.
 */
export function isSupabaseConfigured(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

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

  // Quota/waste guard (2026-06-17): never connect a TEST run to a hosted
  // Supabase without an explicit opt-in — the dev/prod boundary failure that
  // burned prod egress. No-op outside tests / for local Supabase.
  assertHermeticSupabase(url);

  _admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  return _admin;
}
