/** Supabase-backed scoped arrays and acknowledged writes; per-key serialization preserves write order. */
import "server-only";

import { randomUUID } from "node:crypto";

import { resolveDataPath } from "./resolve-data-path";

/** Registered durable arrays; customer releases use their atomic publisher instead. */
const SUPABASE_MIRRORED_STORES = new Set<string>([
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
const CUSTOMER_SURFACE_TABLE = "customer_surface_releases";

/** PostgREST "table missing" (42P01) or "schema cache" (PGRST205) - treat as not-migrated-yet. */
function isMissingBlobsTable(error: { code?: string } | null | undefined): boolean {
  const code = error?.code ?? "";
  return code === "42P01" || code === "PGRST205";
}

/** Successful absence is distinct from unavailable or malformed saved truth. */
type Mirror = { rows: unknown[] | null; reachable: boolean };
async function readMirroredBlob(scopeKey: string, storeName: string): Promise<Mirror> {
  try {
    const { getSupabaseAdmin } = await import("./supabase");
    const query = getSupabaseAdmin().from(storeName === "customer-surface" ? CUSTOMER_SURFACE_TABLE : BLOBS_TABLE)
      .select("content").eq("scope_key", scopeKey);
    const { data, error } = storeName === "customer-surface"
      ? await query.order("generation", { ascending: false }).limit(1).maybeSingle()
      : await query.maybeSingle();
    if (error != null) {
      // EVERY DATABASE ERROR IS UNAVAILABLE, a missing table included: PGRST205 is a schema-cache incident as
      // often as it is configuration, and classing it reachable let one such error erase a warm known-good
      // release (Codex, 2026-08-28). Only a SUCCESSFUL read with no row is genuinely missing. A missing table
      // stays quiet in the logs; a cold unavailable read must fail.
      if (!isMissingBlobsTable(error)) console.error(`[json-store] blob read failed for ${scopeKey}: ${error.message ?? String(error)}`);
      return { rows: null, reachable: false };
    }
    if (data === null) return { rows: null, reachable: true };
    const content = (data as { content?: unknown } | undefined)?.content;
    return { rows: Array.isArray(content) ? content : null, reachable: Array.isArray(content) };
  } catch {
    return { rows: null, reachable: false }; // no env / client init failed
  }
}

async function writeMirroredBlob(scopeKey: string, storeName: string, content: unknown[]): Promise<void> {
  const { getSupabaseAdmin } = await import("./supabase");
  const { data, error } = await getSupabaseAdmin().from(BLOBS_TABLE).upsert(
    { scope_key: scopeKey, store_name: storeName, content, updated_at: new Date().toISOString() },
    { onConflict: "scope_key" },
  ).select("scope_key").maybeSingle();
  if (error != null || data?.scope_key !== scopeKey) {
    throw new Error(`[json-store] saved ${storeName} write was not acknowledged for ${scopeKey}: ${error?.message ?? "missing or mismatched row"}`);
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
 * with no canonical row yet return the caller's `fallback` (or `[]`).
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

export async function readStore<T>(name: string, fallback?: T[], opts: { tenantId?: string; forceRefresh?: boolean } = {}): Promise<T[]> {
  const resolved = await resolveDataPath(name, opts.tenantId);

  if (!opts.forceRefresh && warm(name, resolved.cacheKey)) return cache.get(resolved.cacheKey) as T[];

  // Mirrored stores read canonical durable truth; an unavailable cold read is never absence.
  if (SUPABASE_MIRRORED_STORES.has(name)) {
    const mirror = await readMirroredBlob(resolved.cacheKey, name);
    if (mirror.rows != null) { cache.set(resolved.cacheKey, mirror.rows); filledAt.set(resolved.cacheKey, Date.now()); return mirror.rows as T[]; }
    // A FAILED REFRESH KEEPS THE LAST KNOWN GOOD, stamping only a short retry rather than a full TTL: the rows are stale and never pretend to have been confirmed, but empty is not more true than they are.
    if (!mirror.reachable) {
      if (cache.has(resolved.cacheKey)) { filledAt.set(resolved.cacheKey, Date.now() - MIRROR_TTL_MS + MIRROR_RETRY_MS); return cache.get(resolved.cacheKey) as T[]; }
      throw new Error(`[json-store] saved ${name} is unavailable for ${resolved.cacheKey}`);
    }
  }

  // Non-mirrored legacy wrappers retain process defaults; disk never supplies production truth.
  const initial = fallback ? [...fallback] : [];
  cache.set(resolved.cacheKey, initial); filledAt.set(resolved.cacheKey, Date.now());
  return initial as T[];
}

/** Canonical writes commit before cache publication; failure preserves the last acknowledged rows. */
export async function writeStore<T>(name: string, data: T[], opts: { tenantId?: string } = {}): Promise<void> {
  if (name === "customer-surface") {
    throw new Error("[json-store] customer-surface writes require publishCustomerRelease so ranking and content commit atomically.");
  }
  if (!SUPABASE_MIRRORED_STORES.has(name)) throw new Error(`[json-store] ${name} requires its canonical repository writer`);
  const content = structuredClone(data), resolved = await resolveDataPath(name, opts.tenantId);
  const prev = writeLocks.get(resolved.cacheKey) ?? Promise.resolve();
  const next = prev.then(async () => {
    await writeMirroredBlob(resolved.cacheKey, name, content);
    cache.set(resolved.cacheKey, content); filledAt.set(resolved.cacheKey, Date.now());
  });
  writeLocks.set(resolved.cacheKey, next.catch(() => {}));
  await next;
}
