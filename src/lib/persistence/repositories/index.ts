import "server-only";

/**
 * **App read boundary:** Route and domain logic should use `getRepository()` (or
 * modules that already wrap it). Do not bypass with `readStore` / `readDotDataJson`
 * except in repository backends, persistence writers, and CLI/scripts.
 *
 * SUPABASE IS THE DEFAULT AND THE ONLY PRODUCTION TRUTH. The file backend used to be
 * what an unset DATA_SOURCE fell open to, which is exactly how a second truth comes
 * back: one forgotten env var and production quietly reads local files. Now the file
 * backend is an explicit local-only ask (DATA_SOURCE=file), never a fallback.
 */

import { fileBackend } from "./file-backend";
import { supabaseBackend } from "./supabase-backend";
import type { SeedDataRepository } from "./types";

export type { SeedDataRepository } from "./types";

export function getRepository(): SeedDataRepository {
  return process.env.DATA_SOURCE === "file" ? fileBackend : supabaseBackend;
}
