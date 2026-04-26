/**
 * Raw disk read for `.data/{name}.json` (no json-store cache).
 *
 * Sprint 7 Phase 7.8b-1 (2026-04-25) — async + tenant-aware. Routes
 * per-tenant / singleton stores to `.data/tenants/{slug}/{name}.json`
 * and global stores to `.data/global/{name}.json`.
 *
 * Sprint 7 Phase 7.8d-1 (2026-04-26) — flat fallback removed. Reads
 * for known stores resolve to their routed path or return null when
 * the file isn't on disk yet; reads for **unknown** stores throw
 * fail-loud with a message naming the classification module. Writes
 * never fall back to flat (they always go to the routed path).
 *
 * **Allowed call sites:** `file-backend` / `supabase-backend` (supplementary blobs),
 * plus the two documented exceptions: `universe-read.ts` when `DATA_SOURCE=file`
 * (pin metadata), and `topics/page.tsx` server action (fresh read at mutation time).
 * Elsewhere prefer `getRepository()` or domain store modules.
 */
import "server-only";

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";

import { resolveDataPath } from "./resolve-data-path";

// Phase 7.8b-2-a (2026-04-25): path resolution moved to
// `resolve-data-path.ts` so json-store (Phase 7.8b-2-b) reuses the
// same dispatch.

/**
 * Read `.data/{name}.json` from the per-tenant or global subdir.
 * Returns null when the routed file is missing or malformed for a
 * known store. Throws fail-loud for unknown (unclassified) stores.
 */
export async function readDotDataJson<T>(baseName: string): Promise<T | null> {
  const resolved = await resolveDataPath(baseName);

  if (resolved.scope === "unknown") {
    throw new Error(
      `[dotdata-json] unknown store '${baseName}'. Add it to TENANT_SCOPED_STORES, ` +
        `SINGLETON_STORES, or GLOBAL_STORES in src/lib/persistence/store-classification.ts.`,
    );
  }

  try {
    if (existsSync(resolved.routedPath)) {
      return JSON.parse(readFileSync(resolved.routedPath, "utf8")) as T;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Write `.data/{name}.json` atomically (temp → rename) into the
 * resolved per-tenant or global subdir. Writes NEVER fall back to flat.
 *
 * Phase 3.5A (2026-04-22): Vercel's lambda FS is read-only; skip disk
 * writes on hosted. Callers that need durability must pair this with a
 * Supabase dual-write; stores without dual-write silently no-op on hosted.
 */
export async function writeDotDataJson<T>(
  baseName: string,
  data: T,
): Promise<void> {
  if (process.env.VERCEL === "1") return;

  const resolved = await resolveDataPath(baseName);
  if (resolved.scope === "unknown") {
    throw new Error(
      `[dotdata-json] unknown store '${baseName}'. Add it to TENANT_SCOPED_STORES, ` +
        `SINGLETON_STORES, or GLOBAL_STORES in src/lib/persistence/store-classification.ts.`,
    );
  }

  if (!existsSync(resolved.routedDir)) {
    mkdirSync(resolved.routedDir, { recursive: true });
  }
  const tmp = resolved.routedPath + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, resolved.routedPath);
}
