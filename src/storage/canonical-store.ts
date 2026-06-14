/**
 * Profound import pipeline data stores.
 *
 * This module is consumed ONLY by `adapters/profound/import-orchestrator.ts`.
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
 * `getPromptAnswerObservations`, `getDailyMetricSnapshots`,
 * `getOutcomeEvents`, `getCandidateCauses`, `getEventDecisions`.
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
import type { OutcomeEvent } from "@/domains/outcome-events/types";
import type { CandidateCause } from "@/domains/candidate-causes/types";
import type { EventDecision } from "@/domains/event-decisions/types";

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
  outcomeEvents: OutcomeEvent[] | null;
  candidateCauses: CandidateCause[] | null;
  eventDecisions: EventDecision[] | null;
};

function emptyState(): State {
  return {
    trackedPrompts: null,
    trackedEntities: null,
    observationRuns: null,
    promptAnswerObservations: null,
    dailyMetricSnapshots: null,
    outcomeEvents: null,
    candidateCauses: null,
    eventDecisions: null,
  };
}

// Night-shift cache sweep (2026-06-11): `_state` was a SINGLE process-global
// State object keyed by NOTHING. The live customer render path uses
// `loadFreshCanonicalData()` (already forTenant-scoped, bypasses this cache),
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
 * one-off rebuild scripts) should call `loadFreshCanonicalData(...)`
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
  const [tp, te, or, pao, dms, oe, cc, ed] = await Promise.all([
    readStore<TrackedPrompt>("tracked-prompts"),
    readStore<TrackedEntity>("tracked-entities"),
    readStore<ProfoundImportRun>("observation-runs"),
    readStore<PromptAnswerObservation>("prompt-answer-observations"),
    readStore<DailyMetricSnapshot>("daily-metric-snapshots"),
    readStore<OutcomeEvent>("outcome-events"),
    readStore<CandidateCause>("candidate-causes"),
    readStore<EventDecision>("event-decisions"),
  ]);
  state.trackedPrompts = tp;
  state.trackedEntities = te;
  state.observationRuns = or;
  state.promptAnswerObservations = pao;
  state.dailyMetricSnapshots = dms;
  state.outcomeEvents = oe;
  state.candidateCauses = cc;
  state.eventDecisions = ed;

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

export const getOutcomeEvents = cache(async (): Promise<OutcomeEvent[]> => {
  return (await ensureLoaded()).outcomeEvents!;
});

export const getCandidateCauses = cache(
  async (): Promise<CandidateCause[]> => {
    return (await ensureLoaded()).candidateCauses!;
  },
);

export const getEventDecisions = cache(async (): Promise<EventDecision[]> => {
  return (await ensureLoaded()).eventDecisions!;
});

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

/**
 * Phase 4.9 (Sprint 4, 2026-04-24) — fresh canonical data per render.
 *
 * Bypasses the lazy-getter cache entirely. Render paths that show
 * visibility/decision data (Today, Recommendations, Prompts) call this
 * once per request and pass the returned arrays to downstream pure
 * functions. Module-level getters remain for non-render consumers
 * (poll pipeline, prompt-library, url-citation-history,
 * import-orchestrator, build-from-observations, orchestrate-scan).
 *
 * On repo failure the helper throws. Callers wrap in `safeCall` /
 * try-catch and graceful-degrade to empty arrays with a banner.
 */
export type FreshCanonicalData = {
  trackedPrompts: TrackedPrompt[];
  promptAnswerObservations: PromptAnswerObservation[];
  trackedEntities: TrackedEntity[];
  dailyMetricSnapshots: DailyMetricSnapshot[];
};

/**
 * E3 (operator audit, 2026-05-05) — optional date-window for the two
 * heaviest reads. /today + /prompts only need 30-90 days of recent
 * observations + snapshots (descriptor rollup window is 7 days, the
 * visibility chart shows 14-90 days). Loading the full ~14k-row
 * observation table on every render is the dominant Supabase egress
 * cost. Passing `observationsSince` cuts the wire payload by 60-90%.
 *
 * Default behavior (no options) loads full history — scripts +
 * non-render consumers (URL watcher, materializer, citation index
 * rebuild) keep working unchanged.
 */
export type FreshCanonicalDataOptions = {
  /** ISO date string. When set, prompt_answer_observations are filtered
   *  at the DB with `observed_at >= since`. */
  observationsSince?: string;
  /** ISO date string. When set, daily_metric_snapshots are filtered at
   *  the DB with `for_date >= since`. */
  snapshotsSince?: string;
  /** Optional lean PostgREST projection (comma-separated columns) for the
   *  daily_metric_snapshots read, pushed to the DB so only those columns
   *  cross the wire. The caller MUST only read the columns it requested
   *  (the file backend returns full rows regardless). Used by /today,
   *  whose only snapshot consumer needs `date` for two counts — pulling
   *  the full JSONB-carrying rows was ~90% wasted egress. */
  snapshotsColumns?: string;
  /** Optional lean PostgREST projection (comma-separated columns) for the
   *  prompt_answer_observations read — same contract as `snapshotsColumns`.
   *  /today (2026-06-15) passes the 23 columns its matrix + descriptor
   *  rollups read and OMITS the heavy `metadata` (~5.9 MB / 60d for a busy
   *  tenant) + `citation_domains` / `citation_categories` / search-query
   *  columns it never touches — the read was ~17 MB and the dominant cause
   *  of the /today canonical-read statement-timeout. The packet builder on
   *  the /recommendations-live path (which DOES read `metadata`) passes no
   *  projection, so it still gets full rows. */
  observationsColumns?: string;
};

export async function loadFreshCanonicalData(
  options?: FreshCanonicalDataOptions,
): Promise<FreshCanonicalData> {
  // Customer-2 isolation fix (operator audit, 2026-05-06) — ALL four
  // reads here now go through `tenantRepo.forTenant(tenantId)`. The
  // pre-fix path was Tier-A-scoped + Tier-C-unscoped, which would
  // have leaked Ritz's tracked_prompts + tracked_entities into a
  // second tenant's /today leaderboard at customer-2 onboarding
  // time. Both stores ARE tenant-scoped at the schema level
  // (column: `account_id text NOT NULL`, value: tenant slug); rows
  // on disk carry both `tenant_id` and `account_id`. Pinned by
  // `tests/architecture/canonical-store-tenant-isolation.test.ts`.
  const tenantId = await currentTenantId();
  const repo = getRepository();
  const tenantRepo = repo.forTenant(tenantId);
  const observationsOpt =
    options?.observationsSince || options?.observationsColumns
      ? {
          ...(options.observationsSince
            ? { since: options.observationsSince }
            : {}),
          ...(options.observationsColumns
            ? { columns: options.observationsColumns }
            : {}),
        }
      : undefined;
  const snapshotsOpt =
    options?.snapshotsSince || options?.snapshotsColumns
      ? {
          ...(options.snapshotsSince ? { since: options.snapshotsSince } : {}),
          ...(options.snapshotsColumns
            ? { columns: options.snapshotsColumns }
            : {}),
        }
      : undefined;
  const [prompts, observations, entities, snapshots] = await Promise.all([
    tenantRepo.getTrackedPrompts(),
    tenantRepo.getPromptAnswerObservations(observationsOpt),
    tenantRepo.getTrackedEntities(),
    tenantRepo.getDailyMetricSnapshots(snapshotsOpt),
  ]);
  // `repo` is intentionally retained above for access to non-tenant-
  // scoped global stores (none used in this function today; reserved
  // for future global lookups like change-patterns or tenants-registry
  // diagnostics). If a future change drops the binding, that's fine.
  void repo;
  return {
    trackedPrompts: prompts,
    promptAnswerObservations: observations,
    trackedEntities: entities,
    dailyMetricSnapshots: snapshots,
  };
}

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

export async function persistOutcomeEvents(): Promise<void> {
  await writeStore("outcome-events", await getOutcomeEvents());
}

export async function persistCandidateCauses(): Promise<void> {
  await writeStore("candidate-causes", await getCandidateCauses());
}

export async function persistEventDecisions(): Promise<void> {
  await writeStore("event-decisions", await getEventDecisions());
}

// ---------------------------------------------------------------------------
// Bulk replace helpers (for import pipeline).
// ---------------------------------------------------------------------------

function replaceAll<T>(target: T[], source: T[]): void {
  target.length = 0;
  target.push(...source);
}

export async function replaceTrackedPrompts(
  data: TrackedPrompt[],
  tenantId: string,
): Promise<void> {
  replaceAll(await getTrackedPrompts(), data);
  await persistTrackedPrompts(tenantId);
}

export async function replaceTrackedEntities(
  data: TrackedEntity[],
  tenantId: string,
): Promise<void> {
  replaceAll(await getTrackedEntities(), data);
  await persistTrackedEntities(tenantId);
}

export async function replaceObservationRuns(data: ProfoundImportRun[]): Promise<void> {
  replaceAll(await getObservationRuns(), data);
  await persistObservationRuns();
}

export async function replaceObservations(
  data: PromptAnswerObservation[],
  tenantId: string,
): Promise<void> {
  replaceAll(await getPromptAnswerObservations(), data);
  await persistObservations(tenantId);
}

export async function replaceSnapshots(
  data: DailyMetricSnapshot[],
  tenantId: string,
): Promise<void> {
  replaceAll(await getDailyMetricSnapshots(), data);
  await persistSnapshots(tenantId);
}
