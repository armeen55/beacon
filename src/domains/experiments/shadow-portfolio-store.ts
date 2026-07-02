/**
 * shadow-portfolio-store (2026-07-02, master plan item 65) - persistence for the nightly
 * plan's top rejected-but-eligible candidates ("the shadow portfolio"). Each planning run
 * (build-today-preview.ts) captures the top 5 candidates that were eligible and scored but
 * NOT selected, so their untreated GSC drift becomes a free counterfactual against the
 * picks Beacon actually shipped: "pages we changed moved +9 percent; similar pages we
 * considered but skipped moved +2 percent."
 *
 * Follows the spike-store.ts / gap-store.ts sibling pattern exactly: a GLOBAL json-store
 * (rows carry tenant_id because the nightly planning run has no ambient per-tenant request
 * context) that is Supabase-mirrored so the write survives Vercel's read-only filesystem.
 *
 * Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts (SUPABASE_MIRRORED_STORES).
 *
 * APPEND-ONLY BY DESIGN (unlike spike-store's latest-wins): each night's shadow cohort is its
 * own dated batch, and the measurement pass (shadow-portfolio-drift.ts) needs MANY nights of
 * captured batches whose capture date is now far enough in the past to measure a real window.
 * A batch is never mutated after capture - "what we considered but skipped" is a historical
 * fact, not a live value to overwrite.
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";

const STORE = "shadow-portfolio-candidates";

/** One rejected-but-eligible candidate captured at plan time. Mirrors the numeric shape a
 *  selected pick would have carried (score, forecast range) so the drift-vs-forecast
 *  calibration feed (item 65 part 4) can compare like with like. */
export type ShadowCandidate = {
  /** Canonical page URL. */
  page: string;
  /** Normalized page path (the key gsc-window.ts reads use). */
  pagePath: string;
  /** The action family this candidate would have shipped (meta/title/h1/internal_link/answer_block/refresh). */
  lever: string;
  /** First path segment / page family, the same grouping the planner uses. */
  pageFamily: string;
  targetQuery: string;
  /** The planner's deterministic "tonight value" score (daily-experiment-planner.ts scoreCandidate),
   *  so a shadow row can be ranked or explained the same way a selected pick can. */
  score: number;
  /** Item 27/28 numeric forecast this candidate WOULD have carried had it been selected, absent
   *  when the opportunity was too small to forecast honestly (forecastRange returned null). */
  forecastLow?: number;
  forecastHigh?: number;
};

export type ShadowPortfolioBatch = {
  tenant_id: string;
  /** The plan id these candidates were rejected FROM (provenance, not a foreign-key join). */
  plan_id: string;
  /** YYYY-MM-DD planning date (matches DailyExperimentPlanRecord.date). */
  date: string;
  captured_at: string;
  candidates: ShadowCandidate[];
};

const MAX_CANDIDATES_PER_BATCH = 5;
/** A batch older than this never contributes to the drift comparison - by then GSC data has
 *  aged out of relevance for a "what happened to the pages we skipped" claim. Generous window
 *  (well past the 28-day proof horizon) so a real batch always has time to mature first. */
const BATCH_MAX_AGE_MS = 120 * 24 * 60 * 60 * 1000;

/** Persist tonight's shadow cohort (top rejected-eligible candidates). Additive - other tenants'
 *  and other nights' batches are untouched. An EMPTY candidate list is written too (checked,
 *  nothing eligible-but-skipped tonight is a real, distinct state from never having planned).
 *  Fail-soft: a store error never blocks the plan-persist call site (caller wraps in .catch). */
export async function writeShadowPortfolioBatch(batch: ShadowPortfolioBatch): Promise<void> {
  const trimmed: ShadowPortfolioBatch = { ...batch, candidates: batch.candidates.slice(0, MAX_CANDIDATES_PER_BATCH) };
  const rows = await readStore<ShadowPortfolioBatch>(STORE, []);
  // Idempotent on (tenant_id, plan_id): re-planning the same day replaces that day's batch
  // rather than accumulating duplicates.
  const others = rows.filter((r) => !(r.tenant_id === batch.tenant_id && r.plan_id === batch.plan_id));
  await writeStore(STORE, [...others, trimmed]);
}

/** All non-expired shadow batches for a tenant, oldest first. Fail-soft -> []. */
export async function readShadowPortfolioBatches(
  tenantId: string,
  now: Date = new Date(),
): Promise<ShadowPortfolioBatch[]> {
  try {
    const rows = await readStore<ShadowPortfolioBatch>(STORE, []);
    return rows
      .filter((r) => r.tenant_id === tenantId)
      .filter((r) => {
        const age = now.getTime() - Date.parse(r.captured_at);
        return Number.isFinite(age) && age >= 0 && age < BATCH_MAX_AGE_MS;
      })
      .sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  } catch {
    return [];
  }
}

/** Flat list of every candidate ever captured for a tenant (within the age window), each
 *  carrying its batch's capture date - the shape the drift measurement pass consumes. */
export type ShadowCandidateRecord = ShadowCandidate & { capturedAt: string; planId: string; date: string };

export async function readShadowPortfolioCandidates(
  tenantId: string,
  now: Date = new Date(),
): Promise<ShadowCandidateRecord[]> {
  const batches = await readShadowPortfolioBatches(tenantId, now);
  const out: ShadowCandidateRecord[] = [];
  for (const b of batches) {
    for (const c of b.candidates) {
      out.push({ ...c, capturedAt: b.captured_at, planId: b.plan_id, date: b.date });
    }
  }
  return out;
}
