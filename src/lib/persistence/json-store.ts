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
  // 2026-07-03 R4 adds results-surface (the re-measured proof ledger snapshot) to the
  // same set: without the mirror every hosted /results open pays the full re-measure.
  "worklist-surface",
  "today-surface",
  "results-surface",
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
  // 2026-07-03 T0c - nightly site uptime probes (status + TTFB per tenant).
  // Written by the cron (Vercel lambda: no disk), read by the deadman banner
  // on Today; without the mirror "down twice in a row" could never be seen
  // across lambda instances on hosted prod.
  "site-uptime-probes",
  // 2026-07-03 R12/T0e - the resumable cold-start crawl queue (frontier +
  // cursor + per-page audit facts). Every batch runs in its own lambda, so
  // without the mirror the cursor resets to page zero on every invocation
  // and the crawl could never get past one batch on hosted prod.
  "crawl-frontier",
  // 2026-07-03 R16 (P6 LLM engine pack) - the structured-drafter call cache
  // (content hash -> validated output). Without the mirror every hosted lambda
  // starts cold and an identical regeneration request pays the LLM again; the
  // mirror is what makes the $0-repeat guarantee true on Vercel.
  "llm-call-cache",
  // 2026-07-02 item 13 - nightly precompute warm pass. The per-day run marker
  // (double-fire idempotency) and the "last warmed" receipt /diagnostics shows
  // must survive lambda recycling; losing the marker only costs a harmless
  // re-warm, but the mirror keeps the receipt line truthful on hosted prod.
  "precompute-warm-receipts",
  // 2026-07-02 item 14 - nightly query-spike radar. Written by the cron (Vercel
  // lambda: no disk), read by the Today Demand band + the daily plan builder;
  // without the mirror this week's spikes would be silent-empty on hosted prod.
  "trend-query-spikes",
  // 2026-07-02 item 21 - nightly seasonality pass over the permanent GSC
  // monthly archive. Written by the cron (Vercel lambda: no disk), read by
  // the Today Demand band + the daily plan builder; without the mirror the
  // detected seasonal windows would be silent-empty on hosted prod.
  "seasonal-windows",
  // 2026-07-02 item 63 - the proven-vs-one_season peak calendar (seasonal
  // windows cross-checked against DataForSEO Labs historical volume). Written
  // by the cron (Vercel lambda: no disk), read by the daily plan candidate
  // feed; without the mirror the calendar would be silent-empty on hosted prod.
  "seasonal-peak-calendar",
  // 2026-07-02 item 69 - per-pageFamily weekly+annual demand profiles and the
  // tenant's event calendar (derived entries + operator edits). Written by the
  // seasonality pass / operator CRUD (Vercel lambda: no disk); without the
  // mirror both would be silent-empty (profiles) or lose operator edits
  // (calendar) on hosted prod after a lambda recycle.
  "seasonal-family-profiles",
  // 2026-07-02 item 24 - nightly Farsi/Finglish language-gap matrix pass.
  // Written by the cron (Vercel lambda: no disk), read by the Today Demand
  // band + the daily plan builder; without the mirror the detected gaps
  // would be silent-empty on hosted prod.
  "language-gap-matrix",
  // 2026-07-02 item 56 - nightly refresh queue (pages losing clicks quarter
  // over quarter + their evidence briefs). Written by the cron (Vercel
  // lambda: no disk), read by the Today Demand band + the daily plan
  // builder; without the mirror the queue would be silent-empty on hosted prod.
  "refresh-queue",
  // 2026-07-02 item 26 - the mined citability pattern profile (what AI
  // actually quotes in this tenant's space). Written by the mining pass
  // (no disk on Vercel lambdas), read by the daily card's evidence brief
  // and the citability hint feed; without the mirror the profile would be
  // silent-empty on hosted prod.
  // 2026-07-02 items 27/28 - the forecast calibration ledger (per-pick forecast
  // range vs the realized 28-day monthly click lift, plus outcome inside/above/
  // below). Written by the day-28 measure pass (Vercel lambda, no disk); read by
  // the /results "how honest are my forecasts" card and by pick-expectations.ts's
  // bias-correction factor. Without the mirror both would be silent-empty on
  // hosted prod after every lambda recycle.
  "forecast-calibration",
  // 2026-07-02 item 30 - winner memory (retained mature-won before/after text +
  // structural features per actionFamily, harvested from the measure-pass tail).
  // Written by a Vercel lambda (no disk); read by structured-drafter's few-shot
  // injection. Without the mirror the drafter would silently never see house
  // winners on hosted prod even after real ships settle.
  "winner-memory",
  // 2026-07-02 item 31 - A/A calibration harness (nightly placebo pass measuring
  // Beacon's own false-positive rate + deriving per-traffic-tier verdict floors).
  // Written by a Vercel lambda (no disk); read by measure.ts's readFloorsFor on
  // every real verdict and by the /results explainer's honesty sentence. Without
  // the mirror both would silently fall back to the shipped defaults forever.
  "aa-calibration",
  // 2026-07-02 item 32 - algorithm-weather guard (nightly CUSUM changepoint
  // pass over sitewide daily GSC totals, detecting Google core-update-shaped
  // sitewide shocks). Written by a Vercel lambda (no disk); read by the
  // Results page caveat line and the prior/lesson exclusion gate. Without the
  // mirror the detected shocks would be silent-empty on hosted prod after
  // every lambda recycle, and quarantined verdicts would silently un-quarantine.
  "algorithm-weather-shocks",
  // 2026-07-02 item 34 - pooled batch verdicts (same-plan same-lever multi-page
  // batches stacked into one powered estimate). Written by a Vercel lambda (no
  // disk) from the measure-pass tail; read by /results's batch line. Without the
  // mirror every pooled verdict would be silent-empty on hosted prod after every
  // lambda recycle, hiding a real cross-page pattern the operator paid to learn.
  "pooled-verdicts",
  // 2026-07-02 item 16 - competitor keyword gap engine. The Labs cache is a COST
  // guarantee (a re-run within 30 days must not re-spend, which only holds on
  // Vercel with the mirror); the results store is what the New Pages board reads
  // at $0. File-only, both would be silent-empty on hosted prod.
  "dataforseo-labs-cache",
  "keyword-gap-results",
  // 2026-07-02 item 23 - beat-Wikipedia finder. The article-facts cache is a
  // COST/POLITENESS guarantee (a re-run within 30 days must not re-hit the free
  // Wikipedia API, which only holds on Vercel with the mirror); the results
  // store is what the New Pages board reads at $0. File-only, both would be
  // silent-empty on hosted prod.
  "wiki-gap-article-cache",
  "wiki-gap-results",
  // 2026-07-02 item 38 - team scoreboard (per-specialist and per (specialist,
  // actionFamily) Brier scores + won/flat/lost tallies, joined from settled proof
  // verdicts back to the TeamReview voices on the plan pick that shipped them).
  // Written by a Vercel lambda (no disk) from the measure-pass tail; read by the
  // Today standup strip's honest best-forecaster footer. Without the mirror the
  // scoreboard would be silent-empty on hosted prod after every lambda recycle.
  "team-scoreboard",
  // 2026-07-02 item 51 - the weekly strategy review's append-only lever-mix
  // history (proposed lever weights + focus families + signed memo per week).
  // Written by the Sunday-night cron (Vercel lambda, no disk); read by
  // build-today-preview.ts's multiplier and the Monday recap band. Without the
  // mirror the mix would silently reset to neutral on hosted prod every recycle.
  "strategy-mix-history",
  // 2026-07-02 item 53 - overnight forensic investigation diagnosis cards (one
  // row per tenant/family/week). Written by the nightly cron's isolated
  // investigation phase (Vercel lambda, no disk); read by the Today
  // investigation card. Without the mirror a diagnosis would vanish on the
  // next lambda recycle, and the idempotency check (one investigation per
  // family per week) would silently stop working too.
  "forensic-investigations",
  // 2026-07-02 item 62 - the page factory's weekly batch of demand-validated,
  // drafted-but-staged candidates (one row per tenant/weekOf). Written by the
  // weekly cron (Vercel lambda, no disk); read by the New Pages board's
  // review card. Without the mirror the batch (and its per-page approve/skip
  // state) would vanish on the next lambda recycle, and the weekly idempotency
  // check would silently stop working too.
  "page-factory-batches",
  // 2026-07-02 item 60 - clone-and-beat briefs (traffic-weighted competitor money
  // pages run through the existing teardown, "their best page, our better version").
  // Written by the operator-triggered producer (Vercel lambda, no disk); read by
  // /competitors at $0. Without the mirror the briefs would vanish on the next
  // lambda recycle, forcing a re-spend to see them again.
  "clone-brief-results",
  // 2026-07-02 item 59 - the ask-your-team chat's per-tenant question/answer history
  // (capped, append-only). Written from a request-context server action (not a cron),
  // but Vercel lambda writes still skip disk - without the mirror the operator's recent
  // Q+A history would vanish on the next lambda recycle.
  "ask-history",
  // 2026-07-02 item 65 - the shadow portfolio (top rejected-but-eligible candidates
  // captured at plan time). Written inside build-today-preview.ts (Vercel lambda, no
  // disk); read by the /results "picks vs skipped" line and the drift-vs-forecast
  // calibration feed. Without the mirror each night's captured batch would vanish on
  // the next lambda recycle, and the comparison would never accumulate a real sample.
  "shadow-portfolio-candidates",
  // 2026-07-02 item 73 - Wikidata entity grounding. Same COST/POLITENESS rationale as
  // wiki-gap-article-cache: a re-run within 30 days must not re-hit the free Wikidata
  // API, which only holds on Vercel with the mirror (file-only writes skip disk there).
  "wikidata-entity-cache",
  // 2026-07-02 BEACON_500 item 75 - IndexNow lane. The config (operator-pasted key +
  // optional host/keyLocation/Bing Webmaster key) is written from a request-context
  // server action; the receipts are written from the verify-live path. Both are Vercel
  // lambda writes (no disk) - without the mirror the operator's saved key would vanish
  // on the next lambda recycle (silently disarming the lane) and the receipt trail
  // ("I told Bing X minutes after this went live") would always read empty on hosted prod.
  "indexnow-config",
  "indexnow-receipts",
  // 2026-07-02 master plan item 86 - the nightly publish-path canary (Wix token
  // probe + dry-run per tenant). Written by the cron (Vercel lambda: no disk),
  // read by the publishing-mode card; without the mirror a dead token or stale
  // url-map would only ever be visible for one warm-lambda instance, not the
  // durable "I checked your connection last night" the operator relies on.
  "publish-health",
  // 2026-07-03 BEACON_500 R7 / N39 - the production error spine (app-errors).
  // Errors are recorded almost exclusively ON Vercel lambdas (cron phases,
  // background refreshes, server actions) where file writes skip disk; without
  // the mirror /diagnostics/errors and the Today error-spike line would be
  // silent-empty on hosted prod, which is exactly the failure class the spine
  // exists to end. The blob helpers' PGRST205/42P01 handling doubles as the
  // required file-fallback before the json_store_blobs migration exists.
  "app-errors",
  // 2026-07-02 DREAM SITE V1 item D7 - the opportunity hypothesis log (every
  // forecast opportunity-math.ts renders to the operator, logged so a later
  // day-28 settle can be graded against it). Written from request-context page
  // loads (Vercel lambda: no disk) - without the mirror the log would vanish on
  // the next lambda recycle and forecasts could never be graded for real.
  "opportunity-hypotheses",
  // 2026-07-03 BEACON_500 R11 / N30 - the demand-ranked question universe.
  // Rebuilt + written by the nightly cron on Vercel lambdas (no disk); without
  // the mirror every consumer (drafter seeding, /prompts unanswered-questions
  // section, New Pages brief questions) would read empty on hosted prod the
  // moment the lambda recycled, silently muting the whole N30 feature.
  "question-universe",
  // 2026-07-03 BEACON_500 R13 / N3 - the claim-level provenance graph.
  // Rebuilt by the nightly cron on Vercel lambdas (no disk) and appended
  // from the ship path (also a lambda); without the mirror every consumer
  // (the daily card's per-claim source lines, the claim-conflict trigger,
  // /diagnostics/provenance) would read empty on hosted prod the moment the
  // lambda recycled, silently muting the whole N3 feature.
  "claim-graph",
  // 2026-07-03 BEACON_500 R13b / N26 - fact-propagation plans. Appended from
  // the ship path (a lambda); without the mirror the propagation history on
  // /diagnostics/provenance would vanish on the next lambda recycle and the
  // operator could never see which prepared one-line fixes are still open.
  "fact-propagation-plans",
  // 2026-07-03 BEACON_500 R17b (v1 136+268) - weekly GSC dimension snapshots
  // (searchAppearance + device aggregates). Written by the nightly cron on
  // Vercel lambdas (no disk); the weekly cadence check reads the newest
  // snapshot, so without the mirror every lambda recycle would look like
  // "never pulled" and the pass would re-spend its API calls nightly.
  "gsc-weekly-dimensions",
  // 2026-07-03 BEACON_500 R17b (v1 264) - the fresh-tail volatile cache
  // (Google's EARLY per-day counts for the settling window). Presentation
  // cache only, 3h TTL; the mirror makes the TTL hold across lambda
  // instances so a busy Today page fires at most one fresh read per window.
  "gsc-fresh-tail",
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
