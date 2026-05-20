/**
 * 2026-05-19 — Slice 4.5.B.α₀ + α₁ + α₂ — recommendation-trigger
 * loader.
 *
 * Server-side tenant-scoped loader. Reads `PageSnapshot[]`,
 * invokes the 7 α₀+α₁+α₂ predicates, applies the minimal queue-
 * rules gate, and returns a discriminated result for the
 * operator-only diagnostic page.
 *
 * Predicate invocation pattern (locked):
 *   1. Cross-snapshot duplicate predicates run ONCE over the full
 *      tenant-filtered list BEFORE the per-snapshot loop
 *      (`duplicate-title`, `duplicate-meta`).
 *   2. Per-snapshot predicates run INSIDE the loop, once per
 *      snapshot (`missing-title`, `missing-meta`, `missing-h1`,
 *      `weak-h1`, `title-h1-mismatch`).
 *
 * Hard contracts: no write to `recommended_edits`; no connector /
 * LLM / Supabase mutation on render; no `unstable_cache` (operator
 * wants freshest signal output every load).
 *
 * `weak-h1` consumes `BusinessConfig` (resolved at the loader
 * entry); the other 6 predicates are config-independent.
 */

import "server-only";

import { getBusinessConfig } from "@/lib/business-config";
import type { BusinessConfig } from "@/lib/business-config";
import { getPageSnapshots } from "@/domains/pages/snapshot-store";
import type { PageSnapshot } from "@/domains/pages/types";

import { applyQueueRules } from "./emitter/apply-queue-rules";
import type { RecommendationCandidateRow } from "./emitter/candidate-row";
import { duplicateMeta } from "./triggers/duplicate-meta";
import { duplicateTitle } from "./triggers/duplicate-title";
import { missingH1 } from "./triggers/missing-h1";
import { missingMeta } from "./triggers/missing-meta";
import { missingTitle } from "./triggers/missing-title";
import { titleH1Mismatch } from "./triggers/title-h1-mismatch";
import { weakH1 } from "./triggers/weak-h1";

export type TriggerCandidatesLoadStatus =
  | "ok"
  | "snapshots_unavailable"
  | "config_unavailable";

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

const PREDICATE_COUNT = 7;

function emptyResult(
  status: TriggerCandidatesLoadStatus,
  tenantId: string,
  snapshotCount: number,
): TriggerCandidatesLoadResult {
  return {
    status,
    candidates: [],
    diagnostic_only: [],
    meta: {
      tenant_id: tenantId,
      snapshot_count: snapshotCount,
      predicates_run: PREDICATE_COUNT,
      candidate_count: 0,
      diagnostic_only_count: 0,
    },
  };
}

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
    return emptyResult("snapshots_unavailable", tenantId, 0);
  }

  // α₁: `weak-h1` requires the resolved BusinessConfig. Soft-fail
  // the whole loader to `config_unavailable` rather than partial-
  // running predicates with an unknown config shape.
  let businessConfig: BusinessConfig;
  try {
    businessConfig = getBusinessConfig();
  } catch {
    return emptyResult("config_unavailable", tenantId, snapshots.length);
  }

  const all: RecommendationCandidateRow[] = [];
  // Slice 4.5.B.α₂ — cross-snapshot duplicate predicates run ONCE
  // over the full tenant-filtered list, BEFORE the per-snapshot
  // loop. They aggregate across pages and emit per-occurrence-past-
  // anchor candidates; running them inside the per-snapshot loop
  // would re-aggregate redundantly.
  all.push(...duplicateTitle({ tenantId, snapshots }));
  all.push(...duplicateMeta({ tenantId, snapshots }));
  for (const snapshot of snapshots) {
    all.push(...missingTitle({ tenantId, snapshot }));
    all.push(...missingMeta({ tenantId, snapshot }));
    all.push(...missingH1({ tenantId, snapshot }));
    all.push(...weakH1({ tenantId, snapshot, businessConfig }));
    all.push(...titleH1Mismatch({ tenantId, snapshot }));
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
