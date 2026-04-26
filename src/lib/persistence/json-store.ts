/**
 * On-disk JSON store + in-process cache for `.data/*.json`.
 *
 * **Role today:** Source of truth on disk when `DATA_SOURCE=file`, and the
 * write-through / dual-write target when `DATA_SOURCE=supabase`. Route reads
 * go through `SeedDataRepository` — app code should not call `readStore` for
 * route-critical entities except inside repository backends, writers, CLI, or
 * `storage/canonical-store.ts` (Profound pipeline only).
 *
 * - **Async** read on first access (cached in-process under the resolved
 *   tenant/global cache key thereafter)
 * - Atomic writes via temp-file + rename
 * - Serialized writes per resolved cache key (NOT bare store name) so two
 *   tenants writing to differently-routed files don't serialize on each other
 *
 * Sprint 7 Phase 7.8b-2-b (2026-04-25) — async + tenant-aware + flat
 * fallback. Routes per-tenant / singleton stores to
 * `.data/tenants/{slug}/{name}.json` and global stores to
 * `.data/global/{name}.json`. If the routed file is missing AND a flat
 * `.data/{name}.json` exists, reads return the flat copy with a `warn`
 * log so the operator sees when fallback fires (transitional state
 * between 7.8b runtime conversion and 7.8c migration `--commit`).
 *
 * Writes never fall back to flat — they always go to the routed path.
 *
 * Cache key contract (from resolveDataPath):
 *   - per-tenant + singleton: `${name}::tenant:${slug}`
 *   - global                : `${name}::global`
 *   - unknown               : `${name}::flat`
 *
 * Flat-fallback reads cache under the **resolved** key (per-tenant or
 * global), NEVER under a `${name}::flat` key. That's the invariant
 * that prevents tenant A's flat read from being served to tenant B.
 */

import "server-only";

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";

import { log } from "@/lib/logger";

import { resolveDataPath } from "./resolve-data-path";

/** Computed at call time (not module load) so tests can
 *  `process.chdir()` into a tmpdir and have ensureDataDir follow. */
function ensureDataDir(dir: string): void {
  // Phase 3.5A (2026-04-22): Vercel/serverless filesystems are read-only
  // under process.cwd(); skip the mkdir on hosted so readers fall through
  // to their existsSync check (which returns false for missing files on
  // Vercel) and return empty arrays without crashing the route. Writers
  // already skip disk on VERCEL=1 below.
  if (process.env.VERCEL === "1") return;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * In-process cache. Keyed by the resolver's `cacheKey` (e.g.
 * `imported-results::tenant:ritz-builders` or `business-config::global`).
 * Different tenants reading the same store name end up in different
 * cache slots — no cross-tenant pollution possible.
 */
const cache = new Map<string, unknown[]>();

/**
 * Per-cacheKey write serialization. Two tenants writing to different
 * routed files no longer block each other — each has its own lock chain.
 */
const writeLocks = new Map<string, Promise<void>>();

/**
 * Read a named store. Returns the cached array on subsequent calls
 * (cache key includes tenant scope, so different tenants don't share).
 *
 * If no routed file exists, falls back to the flat
 * `.data/{name}.json` (read-only, logged with `[json-store]
 * flat-fallback read`). The fallback's data is cached under the
 * **resolved** key, NOT under a `flat` key — preserves cross-tenant
 * isolation.
 */
export async function readStore<T>(name: string, fallback?: T[]): Promise<T[]> {
  const resolved = await resolveDataPath(name);

  if (cache.has(resolved.cacheKey)) {
    return cache.get(resolved.cacheKey) as T[];
  }

  ensureDataDir(resolved.routedDir);

  // 1. Routed file wins.
  if (existsSync(resolved.routedPath)) {
    try {
      const raw = readFileSync(resolved.routedPath, "utf-8");
      const data = JSON.parse(raw) as T[];
      cache.set(resolved.cacheKey, data);
      return data;
    } catch {
      // Corrupted routed file — fall through to flat fallback.
    }
  }

  // 2. Read-only flat fallback (Phase 7.8b transitional). Cached under
  // the resolved key, NEVER under `${name}::flat`, so tenant isolation
  // holds even when both tenants share the underlying flat file.
  if (
    resolved.scope !== "unknown" &&
    resolved.routedPath !== resolved.flatPath &&
    existsSync(resolved.flatPath)
  ) {
    try {
      const raw = readFileSync(resolved.flatPath, "utf-8");
      const data = JSON.parse(raw) as T[];
      log.warn("[json-store] flat-fallback read", {
        name,
        scope: resolved.scope,
        cacheKey: resolved.cacheKey,
        routedPath: resolved.routedPath,
        flatPath: resolved.flatPath,
      });
      cache.set(resolved.cacheKey, data);
      return data;
    } catch {
      // Corrupted flat file — fall through to defaults.
    }
  }

  // 3. Empty / fallback.
  const initial = fallback ? [...fallback] : [];
  cache.set(resolved.cacheKey, initial);
  return initial as T[];
}

/**
 * Persist a named store to disk. Uses atomic write (temp → rename).
 * Serialized per resolved cache key so concurrent calls for the same
 * tenant+store don't corrupt; calls for different tenants run
 * concurrently because their cache keys differ.
 *
 * Writes always go to the resolved routed path; never fall back to
 * flat. Vercel skip preserved.
 */
export async function writeStore<T>(name: string, data: T[]): Promise<void> {
  const resolved = await resolveDataPath(name);
  const prev = writeLocks.get(resolved.cacheKey) ?? Promise.resolve();
  const next = prev.then(() => atomicWrite(resolved, data));
  writeLocks.set(resolved.cacheKey, next.catch(() => {}));
  await next;
}

async function atomicWrite<T>(
  resolved: Awaited<ReturnType<typeof resolveDataPath>>,
  data: T[],
): Promise<void> {
  // Vercel: lambda FS is read-only. Update the in-process cache only;
  // skip disk. Supabase dual-write is called by store modules AFTER
  // writeStore, so persistent state still lands in the DB. Stores that
  // aren't yet dual-written no-op on hosted (matches the "expected
  // broken" guardrail).
  if (process.env.VERCEL === "1") {
    cache.set(resolved.cacheKey, data);
    return;
  }

  ensureDataDir(resolved.routedDir);

  // Phase 7.7b Commit 2 / 7.8b-2-b (2026-04-25): import-runs anti-race
  // guard, now per-tenant. Refuses to overwrite a non-empty
  // `import-runs.json` with `[]` so a startup race where the
  // module-level cache pulls `[]` before the file is populated doesn't
  // flush an empty array to disk. Only fires for the import-runs store
  // (matches today's posture); the tenant-aware path means tenant A's
  // guard inspects only tenant A's file — never blocks writes for
  // tenant B.
  if (
    data.length === 0 &&
    /(^|\/)import-runs\.json$/.test(resolved.routedPath) &&
    existsSync(resolved.routedPath)
  ) {
    try {
      const existing = JSON.parse(readFileSync(resolved.routedPath, "utf-8"));
      if (Array.isArray(existing) && existing.length > 0) {
        // Don't overwrite — cache the existing data instead so subsequent
        // reads see the durable rows, not the [].
        cache.set(resolved.cacheKey, existing);
        return;
      }
    } catch {
      // Corrupted file — OK to overwrite.
    }
  }

  const tmp = resolved.routedPath + ".tmp";
  const json = JSON.stringify(data, null, 2);
  writeFileSync(tmp, json, "utf-8");
  renameSync(tmp, resolved.routedPath);
  cache.set(resolved.cacheKey, data);
}
