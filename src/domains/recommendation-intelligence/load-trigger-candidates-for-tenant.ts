/**
 * 2026-05-19 — Slice 4.5.B.α₀ — recommendation-trigger loader.
 *
 * Server-side tenant-scoped loader. Reads `PageSnapshot[]`,
 * invokes the 2 α₀ predicates (`missing-title`, `missing-meta`),
 * applies the minimal queue-rules gate, and returns a discriminated
 * result for the operator-only diagnostic page.
 *
 * Hard contracts: no write to `recommended_edits`; no connector /
 * LLM / Supabase mutation on render; no `unstable_cache` (operator
 * wants freshest signal output every load).
 *
 * α₁ adds H1 predicate wiring; α₂ adds cross-snapshot duplicate
 * predicate wiring.
 */

import "server-only";

import { getPageSnapshots } from "@/domains/pages/snapshot-store";
import type { PageSnapshot } from "@/domains/pages/types";

import { applyQueueRules } from "./emitter/apply-queue-rules";
import type { RecommendationCandidateRow } from "./emitter/candidate-row";
import { missingMeta } from "./triggers/missing-meta";
import { missingTitle } from "./triggers/missing-title";

export type TriggerCandidatesLoadStatus = "ok" | "snapshots_unavailable";

export type TriggerCandidatesLoadResult = {
  status: TriggerCandidatesLoadStatus;
  candidates: RecommendationCandidateRow[];
  diagnostic_only: RecommendationCandidateRow[];
  meta: {
    tenant_id: string;
    snapshot_count: number;
    predicates_run: number;
    candidate_count: number;
    diagnostic_only_count: number;
  };
};

const PREDICATE_COUNT = 2;

function dedupeByKey(
  rows: ReadonlyArray<RecommendationCandidateRow>,
): RecommendationCandidateRow[] {
  const seen = new Set<string>();
  const out: RecommendationCandidateRow[] = [];
  for (const row of rows) {
    if (seen.has(row.dedupe_key)) continue;
    seen.add(row.dedupe_key);
    out.push(row);
  }
  return out;
}

export async function loadTriggerCandidatesForTenant(options: {
  tenantId: string;
}): Promise<TriggerCandidatesLoadResult> {
  const { tenantId } = options;

  let snapshots: PageSnapshot[];
  try {
    const all = await getPageSnapshots();
    snapshots = Array.isArray(all)
      ? all.filter((s) => s != null && s.tenant_id === tenantId)
      : [];
  } catch {
    return {
      status: "snapshots_unavailable",
      candidates: [],
      diagnostic_only: [],
      meta: {
        tenant_id: tenantId,
        snapshot_count: 0,
        predicates_run: PREDICATE_COUNT,
        candidate_count: 0,
        diagnostic_only_count: 0,
      },
    };
  }

  const all: RecommendationCandidateRow[] = [];
  for (const snapshot of snapshots) {
    all.push(...missingTitle({ tenantId, snapshot }));
    all.push(...missingMeta({ tenantId, snapshot }));
  }

  const { candidates, diagnostic_only } = applyQueueRules(all);
  const dedupedC = dedupeByKey(candidates);
  const dedupedD = dedupeByKey(diagnostic_only);

  return {
    status: "ok",
    candidates: dedupedC,
    diagnostic_only: dedupedD,
    meta: {
      tenant_id: tenantId,
      snapshot_count: snapshots.length,
      predicates_run: PREDICATE_COUNT,
      candidate_count: dedupedC.length,
      diagnostic_only_count: dedupedD.length,
    },
  };
}
