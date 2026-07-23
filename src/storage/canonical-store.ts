/**
 * Profound import pipeline data stores.
 *
 * WRITE layer NOW ORPHANED (2026-07-21): the `replace*` seed writers here
 * were called ONLY by `adapters/profound/import-orchestrator.ts`, which was
 * deleted with the Profound CSV import adapter island. The READ helpers
 * (getPromptAnswerObservations, getTrackedPrompts, getDailyMetricSnapshots,
 * etc.) remain LIVE — consumed by load-queue, url-change-outcome,
 * url-citation-history, and others, so this module stays. (Lane S
 * 2026-07-21: the today-v2-data + visibility-read-model consumers were
 * deleted as dead code.) Reaping the dead write/seed functions is a
 * follow-up (4C).
 * **Profound / import pipeline only.** App routes must not use this for website
 * crawl/verify runs — those are `domains/observations/read.ts` → repository.
 * Event decisions for routes use `domains/attribution/store.ts`.
 *
 * Hot stores: loaded eagerly via json-store (small collections).
 * Cold stores: loaded on-demand via cold-store (large observation data).
 *
 * Shared filename: `.data/observation-runs.json` also receives website `ObservationRun`
 * rows from scan/verify. This module only ever treats the file as `ProfoundImportRun[]`
 * (json-store parse). Website runs are read via `SeedDataRepository.getObservationRuns()`
 * (`file-backend` merges typed rows + `scan-runs.json`, skipping Profound-shaped objects).
 *
 * Sprint 7 Phase 7.8e-2 (2026-04-26) — request-scope lift. Module-level
 * top-level `await readStore(...)` calls (which captured the env-resolved
 * tenant once at module init and froze it) are replaced with cached async
 * getters: `getTrackedPrompts`, `getTrackedEntities`, `getObservationRuns`,
 * `getPromptAnswerObservations`, `getDailyMetricSnapshots`.
 *
 * `React.cache` memoizes within one render tree; the process-level
 * per-tenant `_byTenant` state map preserves the mutate-array semantic
 * that the import-orchestrator + persist helpers rely on across requests
 * within one lambda. Initial population still does the Phase 3.5E DB-merge for
 * Vercel-hosted callers (DATA_SOURCE=supabase) so non-render consumers
 * see the same hydrated arrays they did pre-7.8e-2.
 */

import "server-only";

import { cache } from "react";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import {
  syncDailyMetricSnapshots,
  syncPromptAnswerObservations,
  syncTrackedPrompts,
  syncTrackedEntities,
} from "@/lib/persistence/dual-write";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { ProfoundImportRun } from "@/domains/observation-runs/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";

// ---------------------------------------------------------------------------
// Process-level mutable state.
//
// First request through `ensureLoaded()` populates each array by reading
// from json-store (disk) and — when DATA_SOURCE=supabase — merging
// Phase 3.5E hosted-hero data from the repository. Subsequent requests in
// the same lambda + tenant share the SAME array references; mutations land
// in that tenant's state and persist across requests, identical to today's
// behavior — but no longer leak across tenants in a warm process.
// ---------------------------------------------------------------------------

type State = {
  trackedPrompts: TrackedPrompt[] | null;
  trackedEntities: TrackedEntity[] | null;
  observationRuns: ProfoundImportRun[] | null;
  promptAnswerObservations: PromptAnswerObservation[] | null;
  dailyMetricSnapshots: DailyMetricSnapshot[] | null;
};

function emptyState(): State {
  return {
    trackedPrompts: null,
    trackedEntities: null,
    observationRuns: null,
    promptAnswerObservations: null,
    dailyMetricSnapshots: null,
  };
}

// Night-shift cache sweep (2026-06-11): `_state` was a SINGLE process-global
// State object keyed by NOTHING. The live customer render path uses
// the deleted loadFreshCanonicalData() helper (removed 2026-07-21),
// but the module-level getters below — used by the poll pipeline,
// orchestrate-scan, url-citation-history and the Profound importer — served
// the FIRST tenant's eight canonical arrays to every later tenant in a warm
// process (the `loadFromDiskAndMerge` guard short-circuited). All eight stores
// are TENANT_SCOPED. Per-tenant Map of State now; each tenant's arrays stay
// stable refs so the replaceAll/mergeById/persist mutators target the right
// tenant. The disk reads (ambient-routed) and the Supabase merge (currentTenantId)
// already scoped to the active tenant — the cache KEY was the leak.
const _byTenant = new Map<string, State>();

function mergeById<T extends { id: string }>(target: T[], incoming: T[]): void {
  if (incoming.length === 0) return;
  const byId = new Map<string, T>();
  for (const t of target) byId.set(t.id, t);
  for (const i of incoming) byId.set(i.id, i);
  target.length = 0;
  target.push(...byId.values());
}

/**
 * Default window for the canonical-store seed's Supabase merge.
 *
 * Pre-2026-05-12 the seed read `prompt_answer_observations` and
 * `daily_metric_snapshots` UNWINDOWED on every cold lambda — the
 * single largest Supabase-egress driver in the perf+egress audit.
 * The cap below matches the attribution stack's actual data needs:
 *
 *   • `prompt_answer_observations` — 60 days. The longest analysis
 *     window in the codebase is the URL-verdict math
 *     (`DEFAULT_THRESHOLDS.baselineTargetDays=14` +
 *     `postWindowMaxDays=30` = 44 days end-to-end). 60d gives a
 *     comfortable buffer for late-arriving polls + bake-window
 *     reads.
 *   • `daily_metric_snapshots` — 120 days. The visibility chart's
 *     longest preset is 90 days; 120d gives a buffer for chart
 *     `chartEndDate` lookups that anchor on the latest row.
 *
 * Render paths get a windowed in-memory cache; non-render consumers
 * that genuinely need broader history (URL watcher Z-score baseline,
 * one-off rebuild scripts) formerly called the deleted loadFreshCanonicalData
 * with an explicit wider `since`, or read the repo directly with
 * `{ since: ... }` — both bypass the seed's cap.
 *
 * Freshness impact: zero on production render paths. Every consumer
 * inside the v2 customer loop already operates on a ≤60-day analysis
 * window; the wider data was being pulled but never used.
 */
const SEED_OBSERVATIONS_WINDOW_DAYS = 60;
const SEED_SNAPSHOTS_WINDOW_DAYS = 120;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function loadStateForTenant(): Promise<State> {
  const tenantId = await currentTenantId();
  const cached = _byTenant.get(tenantId);
  if (cached && cached.trackedPrompts !== null) return cached;

  const state = cached ?? emptyState();
  _byTenant.set(tenantId, state);

  // Initial disk read for all 8 stores (ambient-routed to this tenant).
  const [tp, te, or, pao, dms] = await Promise.all([
    readStore<TrackedPrompt>("tracked-prompts"),
    readStore<TrackedEntity>("tracked-entities"),
    readStore<ProfoundImportRun>("observation-runs"),
    readStore<PromptAnswerObservation>("prompt-answer-observations"),
    readStore<DailyMetricSnapshot>("daily-metric-snapshots"),
  ]);
  state.trackedPrompts = tp;
  state.trackedEntities = te;
  state.observationRuns = or;
  state.promptAnswerObservations = pao;
  state.dailyMetricSnapshots = dms;

  // Phase 3.5E hosted-hero DB merge — preserved verbatim from the
  // pre-7.8e-2 `ensureCanonicalStoresSeeded()`. On Vercel `.data/*.json`
  // doesn't exist on the read-only FS, so the disk reads above all
  // returned []; the merge below populates the four hero arrays from
  // Supabase. Locally / dev this is additive and keeps in-memory state
  // current with whatever the poll pipeline wrote.
  if (process.env.DATA_SOURCE === "supabase") {
    try {
      // Sprint 7 Phase 7.5c/2 (2026-04-25) — Tier A reads
      // (`getPromptAnswerObservations`, `getDailyMetricSnapshots`) go
      // through `forTenant(tenantId)`.
      //
      // Customer-2 isolation fix (operator audit, 2026-05-06) — Tier C
      // reads (`getTrackedPrompts`, `getTrackedEntities`) NOW also go
      // through `tenantRepo.forTenant(...)`.
      //
      // Perf+egress bundle (2026-05-12) — Tier A reads are now WINDOWED
      // by default (see SEED_OBSERVATIONS_WINDOW_DAYS /
      // SEED_SNAPSHOTS_WINDOW_DAYS above). Pre-window, this merge
      // pulled the full ~12k observation table + ~24k snapshots on
      // every cold lambda; with the 60d/120d caps the wire payload
      // drops by ~75% on a typical tenant. Tracked-prompts +
      // tracked-entities reads are small (<100 rows total) so no
      // window is applied.
      const repo = getRepository();
      const tenantRepo = repo.forTenant(tenantId);
      const observationsSince = isoDaysAgo(SEED_OBSERVATIONS_WINDOW_DAYS);
      const snapshotsSince = isoDaysAgo(SEED_SNAPSHOTS_WINDOW_DAYS);
      const [obs, snaps, ents, prompts] = await Promise.all([
        tenantRepo.getPromptAnswerObservations({ since: observationsSince }),
        tenantRepo.getDailyMetricSnapshots({ since: snapshotsSince }),
        tenantRepo.getTrackedEntities(),
        tenantRepo.getTrackedPrompts(),
      ]);
      mergeById(state.promptAnswerObservations!, obs);
      mergeById(state.dailyMetricSnapshots!, snaps);
      mergeById(state.trackedEntities!, ents);
      mergeById(state.trackedPrompts!, prompts);
    } catch (e) {
      console.error("[canonical-store] DB seed failed:", e);
    }
  }
  return state;
}

/**
 * Constants exported for tests + downstream introspection. Defined
 * here (not in a separate config file) because the seed is the only
 * caller; centralizing keeps the contract in one place.
 */
export const CANONICAL_SEED_WINDOWS = {
  observationsDays: SEED_OBSERVATIONS_WINDOW_DAYS,
  snapshotsDays: SEED_SNAPSHOTS_WINDOW_DAYS,
} as const;

const ensureLoaded = cache(loadStateForTenant);

// ---------------------------------------------------------------------------
// Public getters.
//
// Each is wrapped in `React.cache` so a single render tree resolves the
// array once. The returned reference IS the current tenant's cached array —
// callers may mutate via `.push(...)`, `.length = 0; .push(...rest)`, etc.
// and those mutations persist (per tenant) for the lifetime of the lambda.
// ---------------------------------------------------------------------------

export const getTrackedPrompts = cache(async (): Promise<TrackedPrompt[]> => {
  return (await ensureLoaded()).trackedPrompts!;
});

export const getTrackedEntities = cache(async (): Promise<TrackedEntity[]> => {
  return (await ensureLoaded()).trackedEntities!;
});

export const getObservationRuns = cache(
  async (): Promise<ProfoundImportRun[]> => {
    return (await ensureLoaded()).observationRuns!;
  },
);

export const getPromptAnswerObservations = cache(
  async (): Promise<PromptAnswerObservation[]> => {
    return (await ensureLoaded()).promptAnswerObservations!;
  },
);

export const getDailyMetricSnapshots = cache(
  async (): Promise<DailyMetricSnapshot[]> => {
    return (await ensureLoaded()).dailyMetricSnapshots!;
  },
);

/**
 * Backwards-compat shim. Pre-7.8e-2, callers chained
 * `ensureCanonicalStoresSeeded()` to force the DB-merge before reading
 * module-level arrays. Post-7.8e-2 the merge is automatic on first
 * getter call, but render paths and tests still invoke this name —
 * keep it as a thin proxy so caller cascade stays minimal.
 */
export async function ensureCanonicalStoresSeeded(): Promise<void> {
  await ensureLoaded();
}

/**
 * Test-only reset. Clears the process-level state so the next caller
 * re-runs `loadFromDiskAndMerge()`.
 */
export function _resetCanonicalStoreStateForTests(): void {
  _byTenant.clear();
}

/**
 * Test-only / dev hook. Pre-7.8e-2 this dropped the seed-once flag so
 * the next request re-fetched from Supabase. Post-7.8e-2 the lazy
 * getters serve cached state forever within one lambda; calling this
 * forces the next getter call to re-run disk + DB merge.
 */
export function invalidateCanonicalStoresSeed(): void {
  _resetCanonicalStoreStateForTests();
}


// loadFreshCanonicalData removed 2026-07-21 (CORE 100K): its last
// render-time callers died with the today-v2 loader family; the seeding
// path above (tenantRepo.* reads in loadFromDiskAndMerge) is the one
// surviving tenant-scoped canonical read.

// ---------------------------------------------------------------------------
// Persistence helpers.
// Each reads the cached array via the getter, then writes-back to disk +
// dual-write target.
// ---------------------------------------------------------------------------

export async function persistTrackedPrompts(tenantId: string): Promise<void> {
  const trackedPrompts = await getTrackedPrompts();
  await writeStore("tracked-prompts", trackedPrompts);
  await syncTrackedPrompts(trackedPrompts, tenantId);
}

export async function persistTrackedEntities(tenantId: string): Promise<void> {
  const trackedEntities = await getTrackedEntities();
  await writeStore("tracked-entities", trackedEntities);
  await syncTrackedEntities(trackedEntities, tenantId);
}

export async function persistObservationRuns(): Promise<void> {
  await writeStore("observation-runs", await getObservationRuns());
}

export async function persistObservations(tenantId: string): Promise<void> {
  const promptAnswerObservations = await getPromptAnswerObservations();
  await writeStore("prompt-answer-observations", promptAnswerObservations);
  await syncPromptAnswerObservations(promptAnswerObservations, tenantId);
}

export async function persistSnapshots(tenantId: string): Promise<void> {
  const dailyMetricSnapshots = await getDailyMetricSnapshots();
  await writeStore("daily-metric-snapshots", dailyMetricSnapshots);
  await syncDailyMetricSnapshots(dailyMetricSnapshots, tenantId);
}

