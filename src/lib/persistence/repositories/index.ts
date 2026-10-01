import "server-only";

/**
 * **App read boundary:** Route and domain logic should use `getRepository()` (or
 * modules that already wrap it). Do not bypass with `readStore`
 * except in repository backends, persistence writers, and CLI/scripts.
 *
 * Supabase owns every repository read. Tests inject scoped in-memory clients;
 * environment variables cannot switch publication evidence to another store.
 */

import { supabaseBackend } from "./supabase-backend";
import type { SeedDataRepository } from "./types";

export type { SeedDataRepository } from "./types";

/** Compatibility for consumers of the canonical repository boundary. */
export function usesSupabase(): boolean {
  return true;
}

export function getRepository(): SeedDataRepository {
  return supabaseBackend;
}
