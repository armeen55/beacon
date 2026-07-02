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
 * Sprint 7 Phase 7.8b-2-b (2026-04-25) — async + tenant-aware. Routes
 * per-tenant / singleton stores to `.data/tenants/{slug}/{name}.json`
 * and global stores to `.data/global/{name}.json`.
 *
 * Sprint 7 Phase 7.8d-1 (2026-04-26) — flat fallback removed. Reads
 * for known stores resolve to their routed path or fall back to the
 * empty/default array; reads for **unknown** stores throw fail-loud
 * with a message naming the classification module. The migration
 * (7.8c) moved every flat file into the routed layout, and 7.8d-2
 * relocates the flat originals to `.data/_legacy/`. Any new `.data`
 * store added without a classification entry is a dev error and must
 * surface immediately, not get hidden behind a silent flat path.
 *
 * Writes never fall back to flat — they always go to the routed path.
 *
 * Cache key contract (from resolveDataPath):
 *   - per-tenant + singleton: `${name}::tenant:${slug}`
 *   - global                : `${name}::global`
 *   - unknown               : never reached at runtime (throws above)
 */

import "server-only";

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";

import { resolveDataPath } from "./resolve-data-path";

/**
 * Supabase-mirrored stores (2026-07-01, "make the evidence real in prod").
 *
 * The research caches below hold the team's paid/crawled knowledge (DataForSEO keyword
 * demand, live-SERP patterns, competitor teardowns). As plain json-stores they were
 * FILE-ONLY: writes skip disk on Vercel, so hosted prod rendered from empty caches and
 * the 14-day cost-discipline cache was a local-only guarantee. Stores named here are
 * mirrored to the `json_store_blobs` table (one jsonb blob per resolved scope key -
 * the same whole-array read/write semantics as the file store):
 *   - read: Supabase row wins when present; missing row/table/env falls through to file
 *   - write: file (or cache on Vercel) THEN best-effort upsert to Supabase
 * Fail-soft everywhere: any Supabase error degrades to exactly the old file behavior.
 * Migration: migrations/2026-07-01_json_store_blobs.sql (additive).
 */
const SUPABASE_MIRRORED_STORES = new Set<string>([
  "dataforseo-keywords-cache",
  "dataforseo-serp-cache",
  "research-serp-patterns",
  "competitor-page-audit",
  "dataforseo-llm-mentions",
  // 2026-07-01 items 93/94 - the SWR surface snapshots. Without the mirror, Vercel lambdas
  // only keep them in-process (warm-lambda-only); the blob makes warm true across instances.
  "worklist-surface",
  "today-surface",
  // 2026-07-01 item 1 - trust-budget autopilot state (armed config + daily-run marker +
  // receipts). Must be durable on hosted prod: a file-only write would silently lose the
  // operator's arming and the weekly-budget count on lambda recycle. Fail direction is
  // safe: a missing blob reads as the default DISABLED config.
  "autopilot-state",
  // 2026-07-01 item 4 - nightly AI-engines poll. The answer cache is a COST guarantee
  // (a same-night retry must not re-spend), the run guard is the idempotency guarantee,
  // and the gap summary is what Today + the candidate builder read; on Vercel none of
  // these survive without the mirror.
  "ai-engine-answers",
  "ai-engine-poll-runs",
  "ai-engine-gap-summary",
  // 2026-07-02 item 10 - nightly pipeline invariant check results. Written by the
  // cron (Vercel lambda: no disk), read by the Today Ops card; without the mirror
  // the watchdog's own output would be silent-empty on hosted prod.
  "pipeline-violations",
  // 2026-07-02 item 13 - nightly precompute warm pass. The per-day run marker
  // (double-fire idempotency) and the "last warmed" receipt /diagnostics shows
  // must survive lambda recycling; losing the marker only costs a harmless
  // re-warm, but the mirror keeps the receipt line truthful on hosted prod.
  "precompute-warm-receipts",
  // 2026-07-02 item 14 - nightly query-spike radar. Written by the cron (Vercel
  // lambda: no disk), read by the Today Demand band + the daily plan builder;
  // without the mirror this week's spikes would be silent-empty on hosted prod.
  "trend-query-spikes",
  // 2026-07-02 item 16 - competitor keyword gap engine. The Labs cache is a COST
  // guarantee (a re-run within 30 days must not re-spend, which only holds on
  // Vercel with the mirror); the results store is what the New Pages board reads
  // at $0. File-only, both would be silent-empty on hosted prod.
  "dataforseo-labs-cache",
  "keyword-gap-results",
]);

const BLOBS_TABLE = "json_store_blobs";

/** PostgREST "table missing" (42P01) or "schema cache" (PGRST205) - treat as not-migrated-yet. */
function isMissingBlobsTable(error: { code?: string } | null | undefined): boolean {
  const code = error?.code ?? "";
  return code === "42P01" || code === "PGRST205";
}

async function readMirroredBlob(scopeKey: string): Promise<unknown[] | null> {
  try {
    const { getSupabaseAdmin } = await import("./supabase");
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from(BLOBS_TABLE)
      .select("content")
      .eq("scope_key", scopeKey)
      .maybeSingle();
    if (error != null) {
      if (!isMissingBlobsTable(error)) {
        console.error(`[json-store] blob read failed for ${scopeKey}: ${error.message ?? String(error)}`);
      }
      return null;
    }
    const content = (data as { content?: unknown } | null)?.content;
    return Array.isArray(content) ? content : null;
  } catch {
    return null; // no env / client init failed -> file behavior
  }
}

async function writeMirroredBlob(scopeKey: string, storeName: string, data: unknown[]): Promise<void> {
  try {
    const { getSupabaseAdmin } = await import("./supabase");
    const admin = getSupabaseAdmin();
    const { error } = await admin.from(BLOBS_TABLE).upsert(
      { scope_key: scopeKey, store_name: storeName, content: data, updated_at: new Date().toISOString() },
      { onConflict: "scope_key" },
    );
    if (error != null && !isMissingBlobsTable(error)) {
      console.error(`[json-store] blob write failed for ${scopeKey}: ${error.message ?? String(error)}`);
    }
  } catch {
    // no env -> file-only behavior (local file mode keeps working untouched)
  }
}

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
 * Phase 7.8d-1: unknown-scope reads throw fail-loud. Known stores
 * with no routed file yet return the caller's `fallback` (or `[]`).
 */
export async function readStore<T>(name: string, fallback?: T[]): Promise<T[]> {
  const resolved = await resolveDataPath(name);

  if (resolved.scope === "unknown") {
    throw new Error(
      `[json-store] unknown store '${name}'. Add it to TENANT_SCOPED_STORES, ` +
        `SINGLETON_STORES, or GLOBAL_STORES in src/lib/persistence/store-classification.ts.`,
    );
  }

  if (cache.has(resolved.cacheKey)) {
    return cache.get(resolved.cacheKey) as T[];
  }

  // Mirrored stores: the durable Supabase blob wins when present (this is what makes
  // the research caches exist on hosted prod). Missing row/table/env -> file as before.
  if (SUPABASE_MIRRORED_STORES.has(name)) {
    const blob = await readMirroredBlob(resolved.cacheKey);
    if (blob != null) {
      cache.set(resolved.cacheKey, blob);
      return blob as T[];
    }
  }

  ensureDataDir(resolved.routedDir);

  if (existsSync(resolved.routedPath)) {
    try {
      const raw = readFileSync(resolved.routedPath, "utf-8");
      const data = JSON.parse(raw) as T[];
      cache.set(resolved.cacheKey, data);
      return data;
    } catch {
      // Corrupted routed file — fall through to defaults.
    }
  }

  // Routed file missing or corrupted — return caller's fallback (or []).
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
  if (resolved.scope === "unknown") {
    throw new Error(
      `[json-store] unknown store '${name}'. Add it to TENANT_SCOPED_STORES, ` +
        `SINGLETON_STORES, or GLOBAL_STORES in src/lib/persistence/store-classification.ts.`,
    );
  }
  const prev = writeLocks.get(resolved.cacheKey) ?? Promise.resolve();
  const next = prev.then(async () => {
    await atomicWrite(resolved, data);
    // Mirrored stores: best-effort durable copy AFTER the local write, inside the same
    // per-key lock so blob upserts for one scope never race each other.
    if (SUPABASE_MIRRORED_STORES.has(name)) {
      await writeMirroredBlob(resolved.cacheKey, name, data as unknown[]);
    }
  });
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
