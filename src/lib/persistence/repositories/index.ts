import "server-only";

/**
 * **App read boundary:** Route and domain logic should use `getRepository()` (or
 * modules that already wrap it). Do not bypass with `readStore` / `readDotDataJson`
 * except in repository backends, persistence writers, CLI/scripts, Profound
 * `canonical-store` / `import-orchestrator`, or the two documented exceptions
 * (`universe-read` file mode, `topics` server action) — see `docs/architecture.md`.
 */

import { fileBackend } from "./file-backend";
import { supabaseBackend } from "./supabase-backend";
import type { SeedDataRepository } from "./types";

export type { SeedDataRepository } from "./types";

export function getRepository(): SeedDataRepository {
  return process.env.DATA_SOURCE === "supabase" ? supabaseBackend : fileBackend;
}
