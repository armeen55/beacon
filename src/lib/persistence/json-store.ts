/**
 * On-disk JSON store + in-process cache for `.data/*.json`. Source of truth on disk when DATA_SOURCE=file,
 * write-through target when DATA_SOURCE=supabase; route reads go through SeedDataRepository. Async first
 * read (cached per resolved tenant/global key), atomic temp-file+rename writes, writes serialized per
 * resolved cache key. Tenant-aware routing to `.data/tenants/{slug}/{name}.json` / `.data/global/{name}.json`
 * (Sprint 7, 2026-04-25/26): unknown stores throw fail-loud naming the classification module, never a silent
 * flat path; writes never fall back to flat. Cache keys: `${name}::tenant:${slug}` / `${name}::global`.
 */
import "server-only";

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { randomUUID } from "node:crypto";

import { resolveDataPath } from "./resolve-data-path";

/**
 * Supabase-mirrored stores (2026-07-01): file-only writes skip disk on Vercel, so hosted prod rendered from
 * empty caches. Names here mirror to `json_store_blobs` (one jsonb blob per resolved scope key; read: row
 * wins, else file; write: file then best-effort upsert). Fail-soft to exactly the old file behavior.
 */
export const SUPABASE_MIRRORED_STORES = new Set<string>([
  // Pruned to the stores with a SURVIVING live reader/writer: a mirror registration for a
  // name nothing reads or writes is pure dead weight. Each name below is grep-verified to
  // have at least one live consumer file.

  // The two customer-visible SWR surface snapshots (the ONLY persisted Today+
  // Changes / re-measured proof-ledger releases). Without the mirror every
  // hosted lambda starts cold and pays the full rebuild/re-measure.
  "customer-surface",
  // The reconciliation sweep's durable cursor: file-only it resets to zero on every hosted lambda, and the same first window is swept forever.
  "sweep-cursor",
  "results-surface",
  // Ops ledger written from cron lambdas (no disk), read by error-ledger.ts /
  // the Today Ops + deadman cards.
  "app-errors",
  // Resumable cold-start crawl cursor - every batch is its own lambda, so the
  // mirror is what lets the crawl advance past batch one on hosted prod.
  "crawl-frontier",
  // Winner memory (few-shot injection for the drafter); domains/decision/llm/winner-memory.ts.
  "winner-memory",
  // Competitor overlap verdicts: the $0-repeat guarantee on Vercel, or every dispatch re-buys the same reading.
  "competitor-overlap",
  // The fresh-tail volatile presentation cache.
  "gsc-fresh-tail",
  // The banked searches no page of an account is for; read by the coverage walk on every hosted pass.
  "coverage-needs",
  // The day's heavy evidence aggregates (GSC signals/decay, GA4 values/revenue), keyed by the data's own
  // watermark; readers/daily-read-cache.ts. File-only it no-ops on Vercel and every scheduler tick re-pays
  // 6-second aggregates into a 9-connection PostgREST pool, which is the saturation that stalled delivery.
  "daily-evidence",
  "llm-budget", // THE WRITER'S MONTHLY CEILING, WHICH ONLY EXISTS IF PRODUCTION CAN READ IT. The cap lived in a file that no-ops on Vercel, so hosted `readState` fell back to the code default while the SPEND came from the durable Supabase ledger: two authorities for one door, and the only way to give an account room was editing a constant for every tenant and every month. Mirrored, the operator's per-account ceiling is durable and production reads the same one a local pass does. domains/decision/llm/adjudicator-budget.ts
]);

const BLOBS_TABLE = "json_store_blobs";

/** PostgREST "table missing" (42P01) or "schema cache" (PGRST205) - treat as not-migrated-yet. */
function isMissingBlobsTable(error: { code?: string } | null | undefined): boolean {
  const code = error?.code ?? "";
  return code === "42P01" || code === "PGRST205";
}

/** MISSING IS NOT UNAVAILABLE. This answered `null` to both "no row for this key" and "could not be read", so the caller could only treat the second as the first: after a mirrored key aged out, one transient Supabase failure sent the read to a file hosted does not have, then to the caller's `[]`, which was cached and stamped freshly read, and a saved release could disappear from Today and Changes for the length of a TTL while valid truth sat in hand. A missing TABLE is configuration rather than an outage, so it stays `reachable` and keeps the file behaviour local and test runs have always had. */
type Mirror = { rows: unknown[] | null; reachable: boolean };
async function readMirroredBlob(scopeKey: string): Promise<Mirror> {
  try {
    const { getSupabaseAdmin } = await import("./supabase");
    const { data, error } = await getSupabaseAdmin().from(BLOBS_TABLE).select("content").eq("scope_key", scopeKey).maybeSingle();
    if (error != null) {
      // EVERY DATABASE ERROR IS UNAVAILABLE, a missing table included: PGRST205 is a schema-cache incident as
      // often as it is configuration, and classing it reachable let one such error erase a warm known-good
      // release (Codex, 2026-08-28). Only a SUCCESSFUL read with no row is genuinely missing. A missing table
      // stays quiet in the logs and, cold, still falls through to the file behaviour local runs rely on.
      if (!isMissingBlobsTable(error)) console.error(`[json-store] blob read failed for ${scopeKey}: ${error.message ?? String(error)}`);
      return { rows: null, reachable: false };
    }
    const content = (data as { content?: unknown } | null)?.content;
    return { rows: Array.isArray(content) ? content : null, reachable: true };
  } catch {
    return { rows: null, reachable: false }; // no env / client init failed
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
/** WHEN EACH WARM SLOT WAS FILLED, and how long a MIRRORED one may stand. The slot had no expiry and no invalidation, so once a lambda was warm it served its own copy of the durable blob for the life of the process even after another instance published a newer one, and the operator could be shown yesterday's queue after today's publish (Codex, 2026-08-28). Only Supabase-mirrored keys expire; a local or test store has no second writer and keeps the behaviour it always had. */
const filledAt = new Map<string, number>(); const MIRROR_TTL_MS = 30_000, MIRROR_RETRY_MS = 5_000;
const warm = (name: string, key: string): boolean => cache.has(key) && (!SUPABASE_MIRRORED_STORES.has(name) || Date.now() - (filledAt.get(key) ?? 0) < MIRROR_TTL_MS);

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
 *
 * P2-f (2026-07-10, visual audit) - `opts.tenantId`, same purpose as writeStore's:
 * lets a background caller (e.g. a next/server after() rebuild) read the tenant it
 * already has explicitly, instead of falling back to ambient currentTenantSlug().
 */
/** ONE WINNER PER SCOPE, DECIDED BY THE DATABASE: insert wins a virgin scope, a conditional update takes only
 *  an EXPIRED hold, and everything else is refused. The winner gets an owner token; releaseScope lands only
 *  while that exact token still holds, so a holder that outlived its TTL frees nothing on its way out.
 *  FAIL-CLOSED in every hosted failure mode (a broken instance must not hand the hold to everybody at once);
 *  only explicitly local file mode, and the vitest hermetic case, grant without a database. */
export async function claimScope(name: string, key: string, ttlSeconds: number): Promise<string | null> {
  const scopeKey = `${name}::${key}`;
  // THE CLAIM IS OWNED, not just timed. A release keyed on the scope alone let a holder that outlived its TTL
  // free the NEXT holder's live claim on its way out, and a third instance then rebuilt concurrently with the
  // second. The winner gets a token; renewal and release land only while that exact token still holds.
  const owner = randomUUID();
  // Hermetic under vitest exactly as the budget check is: a test run with no database configured is one
  // process with nothing to race, so the claim is granted rather than refusing every unmocked fixture. A
  // test that pins the hosted fail-closed behaviour sets DATA_SOURCE, exactly as those tests already do.
  if (process.env.VITEST && !process.env.DATA_SOURCE && !process.env.NEXT_PUBLIC_SUPABASE_URL) return owner;
  // THE ONE STATE THAT MAY GRANT WITHOUT A DATABASE: file mode, and not on the hosted platform.
  const localFileMode = process.env.DATA_SOURCE === "file" && process.env.VERCEL !== "1";
  const refuse = (why: string): string | null => {
    if (localFileMode) return owner;
    console.error(`[json-store] claim refused for ${scopeKey}: ${why}`);
    return null; // nobody won, which is always safer than everybody winning
  };
  let admin: Awaited<ReturnType<typeof import("./supabase")["getSupabaseAdmin"]>>;
  try {
    admin = (await import("./supabase")).getSupabaseAdmin();
  } catch (error) {
    return refuse(`the database client would not start: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`);
  }
  try {
    const now = new Date(), until = new Date(now.getTime() + Math.max(1, ttlSeconds) * 1000).toISOString();
    const content = [{ until, owner }];
    // Nobody has ever claimed this scope: the insert IS the claim, and a duplicate key means somebody beat us here.
    const first = await admin.from(BLOBS_TABLE).insert({ scope_key: scopeKey, store_name: name, content, updated_at: now.toISOString() }).select("scope_key");
    if (first.error == null) return Array.isArray(first.data) && first.data.length > 0 ? owner : refuse("the insert answer could not be read");
    if (isMissingBlobsTable(first.error)) return refuse("the claims table is not migrated here");
    // The row exists, so the claim is a conditional overwrite of an EXPIRED hold and nothing else.
    const taken = await admin.from(BLOBS_TABLE)
      .update({ content, updated_at: now.toISOString() })
      .eq("scope_key", scopeKey).lt("content->0->>until", now.toISOString()).select("scope_key");
    if (taken.error != null) return refuse(`the claim statement failed: ${taken.error.message ?? String(taken.error)}`);
    // AN ANSWER THAT IS NOT A LIST IS NOT AN ANSWER. A null or malformed response says nothing about who holds
    // the scope, and reading it as "no rows, so somebody else has it" is a guess either way.
    if (!Array.isArray(taken.data)) return refuse("the claim answer could not be read");
    return taken.data.length > 0 ? owner : null;
  } catch (error) {
    return refuse(`the claim threw: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`);
  }
}

/** Free a hold this caller won, so the next legitimate rebuild does not wait out the TTL. ONLY WITH THE
 *  WINNER'S OWN TOKEN: a holder that outlived its TTL comes back to a claim that is no longer its own, and
 *  its late release must change nothing, or it frees the live successor's hold for a third instance. Best
 *  effort: a release that fails simply leaves the hold to expire on its own, which is the safety the TTL
 *  exists for. */
export async function releaseScope(name: string, key: string, owner: string): Promise<void> {
  try {
    const { getSupabaseAdmin } = await import("./supabase");
    await getSupabaseAdmin().from(BLOBS_TABLE)
      .update({ content: [{ until: new Date(0).toISOString() }], updated_at: new Date().toISOString() })
      .eq("scope_key", `${name}::${key}`).eq("content->0->>owner", owner);
  } catch {
    // expiry handles it
  }
}

export async function readStore<T>(name: string, fallback?: T[], opts: { tenantId?: string } = {}): Promise<T[]> {
  const resolved = await resolveDataPath(name, opts.tenantId);

  if (resolved.scope === "unknown") {
    throw new Error(
      `[json-store] unknown store '${name}'. Add it to TENANT_SCOPED_STORES, ` +
        `SINGLETON_STORES, or GLOBAL_STORES in src/lib/persistence/store-classification.ts.`,
    );
  }

  if (warm(name, resolved.cacheKey)) return cache.get(resolved.cacheKey) as T[];

  // Mirrored stores: the durable Supabase blob wins when present (this is what makes
  // the research caches exist on hosted prod). Missing row/table/env -> file as before.
  let degraded = false;
  if (SUPABASE_MIRRORED_STORES.has(name)) {
    const mirror = await readMirroredBlob(resolved.cacheKey);
    if (mirror.rows != null) { cache.set(resolved.cacheKey, mirror.rows); filledAt.set(resolved.cacheKey, Date.now()); return mirror.rows as T[]; }
    // A FAILED REFRESH KEEPS THE LAST KNOWN GOOD, stamping only a short retry rather than a full TTL: the rows are stale and never pretend to have been confirmed, but empty is not more true than they are.
    if (!mirror.reachable) {
      if (cache.has(resolved.cacheKey)) { filledAt.set(resolved.cacheKey, Date.now() - MIRROR_TTL_MS + MIRROR_RETRY_MS); return cache.get(resolved.cacheKey) as T[]; }
      degraded = true; // COLD AND UNAVAILABLE: fall through to file/fallback exactly as before, but stamp only the short retry so a recovering database is asked again in seconds rather than a full TTL
    }
  }

  ensureDataDir(resolved.routedDir);

  if (existsSync(resolved.routedPath)) {
    try {
      const raw = readFileSync(resolved.routedPath, "utf-8");
      const data = JSON.parse(raw) as T[];
      cache.set(resolved.cacheKey, data); filledAt.set(resolved.cacheKey, degraded ? Date.now() - MIRROR_TTL_MS + MIRROR_RETRY_MS : Date.now());
      return data;
    } catch {
      // Corrupted routed file — fall through to defaults.
    }
  }

  // Routed file missing or corrupted — return caller's fallback (or []).
  const initial = fallback ? [...fallback] : [];
  cache.set(resolved.cacheKey, initial); filledAt.set(resolved.cacheKey, degraded ? Date.now() - MIRROR_TTL_MS + MIRROR_RETRY_MS : Date.now());
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
 *
 * P2-f (2026-07-10, visual audit) - `opts.tenantId` lets a caller that already
 * has the correct tenant in hand (e.g. a next/server after() background rebuild)
 * write there explicitly, instead of resolveDataPath falling back to the ambient
 * currentTenantSlug() (request-header-based; not guaranteed reliable outside the
 * render's request scope). Omitted -> unchanged ambient behavior.
 */
export async function writeStore<T>(name: string, data: T[], opts: { tenantId?: string } = {}): Promise<void> {
  const resolved = await resolveDataPath(name, opts.tenantId);
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
    cache.set(resolved.cacheKey, data); filledAt.set(resolved.cacheKey, Date.now());
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
        cache.set(resolved.cacheKey, existing); filledAt.set(resolved.cacheKey, Date.now());
        return;
      }
    } catch {
      // Corrupted file — OK to overwrite.
    }
  }

  // Unique temp names prevent independent Node workers (test runners, CLI
  // jobs, overlapping serverless work) from renaming one another's file.
  const tmp = `${resolved.routedPath}.${process.pid}.${randomUUID()}.tmp`;
  const json = JSON.stringify(data, null, 2);
  writeFileSync(tmp, json, "utf-8");
  renameSync(tmp, resolved.routedPath);
  cache.set(resolved.cacheKey, data); filledAt.set(resolved.cacheKey, Date.now());
}
