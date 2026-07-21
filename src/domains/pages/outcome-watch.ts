/**
 * Outcome Watch — post-ship observation + result linkage for verified rollouts.
 *
 * Generates lightweight outcome observations by comparing current evidence
 * against the state at verification time. Connects rollouts to scorecard
 * and result movement using page path + topic overlap + timing windows.
 */

import { cache } from "react";
import { currentTenantId } from "@/lib/tenant-context";

import { getRepository } from "@/lib/persistence/repositories";

// ── Types ──

export type OutcomeAssessment =
  | "too_early"
  | "incubating"
  | "early_movement"
  | "likely_no_visible_effect_yet"
  | "mixed_signal"
  | "promising_but_ambiguous";

export type OutcomeObservation = {
  outcomeObservationId: string;
  issueId: string;
  rolloutExecutionId: string;
  sourcePatternId: string;
  targetPage: string;
  observedAt: string;
  daysSinceVerified: number;
  citationCount: number | null;
  citationDelta: number | null;
  scorecardSignals: string;
  resultSignals: string;
  outcomeAssessment: OutcomeAssessment;
  evidenceSummary: string;
  linkedResultIds: string[];
  notes: string | null;
};

// Night-shift cache sweep (2026-06-11): this was a process-global
// mutable cache keyed by NOTHING — in a warm multi-tenant process the
// first tenant pinned its rows for every later tenant (the same class
// fixed across 7 other stores tonight). Per-tenant Map now; the
// underlying read stays ambient-routed (per-tenant on disk), so the
// cache key was the leak. Stable per-tenant array refs preserve the
// in-place mutator semantics.
const _byTenant = new Map<string, OutcomeObservation[]>();

const ensureLoaded = cache(async (): Promise<OutcomeObservation[]> => {
  const tenantId = await currentTenantId();
  const cached = _byTenant.get(tenantId);
  if (cached) return cached;
  const loaded = await getRepository().getOutcomeObservations();
  _byTenant.set(tenantId, loaded);
  return loaded;
});

export const getOutcomeObservations = cache(
  async (): Promise<OutcomeObservation[]> => {
    return ensureLoaded();
  },
);

