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
 * `_state` map preserves the mutate-array semantic that the
 * import-orchestrator + persist helpers rely on across requests within
 * one lambda. Initial population still does the Phase 3.5E DB-merge for
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
// the same lambda share the SAME array references; mutations land in
// `_state` and persist across requests, identical to today's behavior.
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

const _state: State = {
  trackedPrompts: null,
  trackedEntities: null,
  observationRuns: null,
  promptAnswerObservations: null,
  dailyMetricSnapshots: null,
  outcomeEvents: null,
  candidateCauses: null,
  eventDecisions: null,
};

function mergeById<T extends { id: string }>(target: T[], incoming: T[]): void {
  if (incoming.length === 0) return;
  const byId = new Map<string, T>();
  for (const t of target) byId.set(t.id, t);
  for (const i of incoming) byId.set(i.id, i);
  target.length = 0;
  target.push(...byId.values());
}

async function loadFromDiskAndMerge(): Promise<void> {
  if (_state.trackedPrompts !== null) return;

  // Initial disk read for all 8 stores.
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
  _state.trackedPrompts = tp;
  _state.trackedEntities = te;
  _state.observationRuns = or;
  _state.promptAnswerObservations = pao;
  _state.dailyMetricSnapshots = dms;
  _state.outcomeEvents = oe;
  _state.candidateCauses = cc;
  _state.eventDecisions = ed;

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
      // through `tenantRepo.forTenant(...)`. The audit found that
      // tracked_prompts + tracked_entities ARE tenant-scoped at the
      // schema level (column: `account_id text NOT NULL`, value:
      // tenant slug), and rows on disk carry both `tenant_id` and
      // `account_id`. The unscoped global reads were a data-leak risk
      // pre-customer-2 — a second tenant would have inherited Ritz's
      // prompts + competitors on their /today leaderboard.
      const tenantId = await currentTenantId();
      const repo = getRepository();
      const tenantRepo = repo.forTenant(tenantId);
      const [obs, snaps, ents, prompts] = await Promise.all([
        tenantRepo.getPromptAnswerObservations(),
        tenantRepo.getDailyMetricSnapshots(),
        tenantRepo.getTrackedEntities(),
        tenantRepo.getTrackedPrompts(),
      ]);
      mergeById(_state.promptAnswerObservations, obs);
      mergeById(_state.dailyMetricSnapshots, snaps);
      mergeById(_state.trackedEntities, ents);
      mergeById(_state.trackedPrompts, prompts);
    } catch (e) {
      console.error("[canonical-store] DB seed failed:", e);
    }
  }
}

const ensureLoaded = cache(loadFromDiskAndMerge);

// ---------------------------------------------------------------------------
// Public getters.
//
// Each is wrapped in `React.cache` so a single render tree resolves the
// array once. The returned reference IS the cached array — callers may
// mutate via `.push(...)`, `.length = 0; .push(...rest)`, etc. and those
// mutations persist for the lifetime of the lambda (same as today).
// ---------------------------------------------------------------------------

export const getTrackedPrompts = cache(async (): Promise<TrackedPrompt[]> => {
  await ensureLoaded();
  return _state.trackedPrompts!;
});

export const getTrackedEntities = cache(async (): Promise<TrackedEntity[]> => {
  await ensureLoaded();
  return _state.trackedEntities!;
});

export const getObservationRuns = cache(
  async (): Promise<ProfoundImportRun[]> => {
    await ensureLoaded();
    return _state.observationRuns!;
  },
);

export const getPromptAnswerObservations = cache(
  async (): Promise<PromptAnswerObservation[]> => {
    await ensureLoaded();
    return _state.promptAnswerObservations!;
  },
);

export const getDailyMetricSnapshots = cache(
  async (): Promise<DailyMetricSnapshot[]> => {
    await ensureLoaded();
    return _state.dailyMetricSnapshots!;
  },
);

export const getOutcomeEvents = cache(async (): Promise<OutcomeEvent[]> => {
  await ensureLoaded();
  return _state.outcomeEvents!;
});

export const getCandidateCauses = cache(
  async (): Promise<CandidateCause[]> => {
    await ensureLoaded();
    return _state.candidateCauses!;
  },
);

export const getEventDecisions = cache(async (): Promise<EventDecision[]> => {
  await ensureLoaded();
  return _state.eventDecisions!;
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
  _state.trackedPrompts = null;
  _state.trackedEntities = null;
  _state.observationRuns = null;
  _state.promptAnswerObservations = null;
  _state.dailyMetricSnapshots = null;
  _state.outcomeEvents = null;
  _state.candidateCauses = null;
  _state.eventDecisions = null;
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
  const observationsOpt = options?.observationsSince
    ? { since: options.observationsSince }
    : undefined;
  const snapshotsOpt = options?.snapshotsSince
    ? { since: options.snapshotsSince }
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

export async function persistTrackedPrompts(): Promise<void> {
  const trackedPrompts = await getTrackedPrompts();
  await writeStore("tracked-prompts", trackedPrompts);
  await syncTrackedPrompts(trackedPrompts);
}

export async function persistTrackedEntities(): Promise<void> {
  const trackedEntities = await getTrackedEntities();
  await writeStore("tracked-entities", trackedEntities);
  await syncTrackedEntities(trackedEntities);
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

export async function replaceTrackedPrompts(data: TrackedPrompt[]): Promise<void> {
  replaceAll(await getTrackedPrompts(), data);
  await persistTrackedPrompts();
}

export async function replaceTrackedEntities(data: TrackedEntity[]): Promise<void> {
  replaceAll(await getTrackedEntities(), data);
  await persistTrackedEntities();
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
