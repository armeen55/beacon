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
 */

import "server-only";

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
// Hot stores — small, loaded at startup
// ---------------------------------------------------------------------------
//
// Phase 7.8b-2-c (2026-04-25): top-level await because `readStore` is
// async (Phase 7.8b-2-b). Same module-load-tenant-capture caveat as
// `seed-data.server.ts` and the singleton stores in 7.8b-1 — captures
// the env-resolved tenant once at module load. Phase 7.8e lifts these
// to request-scope; until then, single-tenant production is unaffected
// because BEACON_TENANT_ID is constant per process.

export const trackedPrompts: TrackedPrompt[] = await readStore<TrackedPrompt>("tracked-prompts");
export const trackedEntities: TrackedEntity[] = await readStore<TrackedEntity>("tracked-entities");
export const observationRuns: ProfoundImportRun[] = await readStore<ProfoundImportRun>("observation-runs");
export const promptAnswerObservations: PromptAnswerObservation[] =
  await readStore<PromptAnswerObservation>("prompt-answer-observations");
export const dailyMetricSnapshots: DailyMetricSnapshot[] =
  await readStore<DailyMetricSnapshot>("daily-metric-snapshots");
export const outcomeEvents: OutcomeEvent[] = await readStore<OutcomeEvent>("outcome-events");
export const candidateCauses: CandidateCause[] = await readStore<CandidateCause>("candidate-causes");
export const eventDecisions: EventDecision[] = await readStore<EventDecision>("event-decisions");

// ---------------------------------------------------------------------------
// Phase 3.5E (2026-04-22) — hosted hero-surface seeder.
//
// On Vercel, the module-init `readStore(...)` calls above return `[]` because
// `.data/*.json` doesn't exist on the read-only FS. `ensureCanonicalStoresSeeded()`
// merges Supabase state into the four module-level arrays that drive Today's
// visibility score, rankings, competitor comparison, and entity universe.
//
// Idempotent — first call awaits the DB fetches, subsequent calls return
// immediately. Same pattern as the 3.5C rec-response / url-outcome seeders.
//
// Scope is DELIBERATELY narrow: only the four stores that drive today's hero
// path are seeded. `observationRuns`, `outcomeEvents`, `candidateCauses`, and
// `eventDecisions` are left as module-init `readStore` reads (unused on the
// hosted critical path today; revisit if that changes).
// ---------------------------------------------------------------------------

let _canonSeeded = false;
let _canonSeedPromise: Promise<void> | null = null;

export async function ensureCanonicalStoresSeeded(): Promise<void> {
  if (_canonSeeded) return;
  if (_canonSeedPromise) return _canonSeedPromise;
  if (process.env.DATA_SOURCE !== "supabase") {
    _canonSeeded = true;
    return;
  }
  _canonSeedPromise = (async () => {
    try {
      // Sprint 7 Phase 7.5c/2 (2026-04-25) — Tier A reads
      // (`getPromptAnswerObservations`, `getDailyMetricSnapshots`) go through
      // `forTenant(tenantId)`. Tier C reads (`getTrackedEntities`,
      // `getTrackedPrompts`) stay unscoped — those tables don't have a
      // `tenant_id` column today (Phase 7.5a Tier C audit).
      const tenantId = await currentTenantId();
      const repo = getRepository();
      const tenantRepo = repo.forTenant(tenantId);
      const [obs, snaps, ents, prompts] = await Promise.all([
        tenantRepo.getPromptAnswerObservations(),
        tenantRepo.getDailyMetricSnapshots(),
        repo.getTrackedEntities(),
        repo.getTrackedPrompts(),
      ]);
      // Merge semantics: DB is the source of truth on hosted. If the local
      // array has anything (dev mode), prefer DB rows by id; otherwise replace.
      // In practice on Vercel all four start empty, so this degenerates to a
      // straight replace.
      if (obs.length > 0) {
        const byId = new Map<string, PromptAnswerObservation>();
        for (const o of promptAnswerObservations) byId.set(o.id, o);
        for (const o of obs) byId.set(o.id, o);
        promptAnswerObservations.length = 0;
        promptAnswerObservations.push(...byId.values());
      }
      if (snaps.length > 0) {
        const byId = new Map<string, DailyMetricSnapshot>();
        for (const s of dailyMetricSnapshots) byId.set(s.id, s);
        for (const s of snaps) byId.set(s.id, s);
        dailyMetricSnapshots.length = 0;
        dailyMetricSnapshots.push(...byId.values());
      }
      if (ents.length > 0) {
        const byId = new Map<string, TrackedEntity>();
        for (const e of trackedEntities) byId.set(e.id, e);
        for (const e of ents) byId.set(e.id, e);
        trackedEntities.length = 0;
        trackedEntities.push(...byId.values());
      }
      if (prompts.length > 0) {
        const byId = new Map<string, TrackedPrompt>();
        for (const p of trackedPrompts) byId.set(p.id, p);
        for (const p of prompts) byId.set(p.id, p);
        trackedPrompts.length = 0;
        trackedPrompts.push(...byId.values());
      }
    } catch (e) {
      console.error("[canonical-store] DB seed failed:", e);
    } finally {
      _canonSeeded = true;
    }
  })();
  return _canonSeedPromise;
}

/** Reset the seed cache. Use after large mutations if freshness matters. */
export function invalidateCanonicalStoresSeed(): void {
  _canonSeeded = false;
  _canonSeedPromise = null;
}

/**
 * Phase 4.9 (Sprint 4, 2026-04-24) — fresh canonical data per render.
 *
 * The module-level arrays above are seeded exactly once per Vercel lambda
 * behind `_canonSeeded`. After the 07:00 UTC poll writes fresh
 * observations + derived snapshots to Supabase, already-warm lambdas keep
 * serving their original seed forever until cold-recycled. This helper
 * bypasses the seed cache entirely — fetches all four canonical tables
 * fresh from the repository in parallel.
 *
 * Contract: render paths that show visibility/decision data to the
 * operator (Today, Recommendations, Prompts) must await this helper once
 * per request and pass the returned arrays to downstream pure functions.
 * Module-level arrays remain for non-render consumers (poll pipeline,
 * prompt-library, url-citation-history, import-orchestrator,
 * build-from-observations, orchestrate-scan) — those update their own
 * module state via `ensureCanonicalStoresSeeded()` or direct mutation.
 *
 * On repo failure the helper throws. Callers wrap in `safeCall` /
 * try-catch and graceful-degrade to empty arrays with a banner; they
 * must NOT silently fall back to module-level stale state.
 */
export type FreshCanonicalData = {
  trackedPrompts: TrackedPrompt[];
  promptAnswerObservations: PromptAnswerObservation[];
  trackedEntities: TrackedEntity[];
  dailyMetricSnapshots: DailyMetricSnapshot[];
};

export async function loadFreshCanonicalData(): Promise<FreshCanonicalData> {
  // Sprint 7 Phase 7.5c/2 (2026-04-25) — same tier split as
  // `ensureCanonicalStoresSeeded`: Tier A reads scoped to tenant; Tier C
  // (tracked_prompts, tracked_entities) stay unscoped. Note: this function
  // is called from /today render and other tenant-scoped surfaces; tenantId
  // resolves via header (post-7.4) or BEACON_TENANT_ID env (post-7.3).
  const tenantId = await currentTenantId();
  const repo = getRepository();
  const tenantRepo = repo.forTenant(tenantId);
  const [prompts, observations, entities, snapshots] = await Promise.all([
    repo.getTrackedPrompts(),
    tenantRepo.getPromptAnswerObservations(),
    repo.getTrackedEntities(),
    tenantRepo.getDailyMetricSnapshots(),
  ]);
  return {
    trackedPrompts: prompts,
    promptAnswerObservations: observations,
    trackedEntities: entities,
    dailyMetricSnapshots: snapshots,
  };
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

export async function persistTrackedPrompts(): Promise<void> {
  await writeStore("tracked-prompts", trackedPrompts);
  await syncTrackedPrompts(trackedPrompts);
}

export async function persistTrackedEntities(): Promise<void> {
  await writeStore("tracked-entities", trackedEntities);
  await syncTrackedEntities(trackedEntities);
}

export async function persistObservationRuns(): Promise<void> {
  await writeStore("observation-runs", observationRuns);
}

export async function persistObservations(tenantId: string): Promise<void> {
  await writeStore("prompt-answer-observations", promptAnswerObservations);
  await syncPromptAnswerObservations(promptAnswerObservations, tenantId);
}

export async function persistSnapshots(tenantId: string): Promise<void> {
  await writeStore("daily-metric-snapshots", dailyMetricSnapshots);
  await syncDailyMetricSnapshots(dailyMetricSnapshots, tenantId);
}

export async function persistOutcomeEvents(): Promise<void> {
  await writeStore("outcome-events", outcomeEvents);
}

export async function persistCandidateCauses(): Promise<void> {
  await writeStore("candidate-causes", candidateCauses);
}

export async function persistEventDecisions(): Promise<void> {
  await writeStore("event-decisions", eventDecisions);
}

// ---------------------------------------------------------------------------
// Bulk replace helpers (for import pipeline)
// ---------------------------------------------------------------------------

function replaceAll<T>(target: T[], source: T[]): void {
  target.length = 0;
  target.push(...source);
}

export async function replaceTrackedPrompts(data: TrackedPrompt[]): Promise<void> {
  replaceAll(trackedPrompts, data);
  await persistTrackedPrompts();
}

export async function replaceTrackedEntities(data: TrackedEntity[]): Promise<void> {
  replaceAll(trackedEntities, data);
  await persistTrackedEntities();
}

export async function replaceObservationRuns(data: ProfoundImportRun[]): Promise<void> {
  replaceAll(observationRuns, data);
  await persistObservationRuns();
}

export async function replaceObservations(
  data: PromptAnswerObservation[],
  tenantId: string,
): Promise<void> {
  replaceAll(promptAnswerObservations, data);
  await persistObservations(tenantId);
}

export async function replaceSnapshots(
  data: DailyMetricSnapshot[],
  tenantId: string,
): Promise<void> {
  replaceAll(dailyMetricSnapshots, data);
  await persistSnapshots(tenantId);
}
