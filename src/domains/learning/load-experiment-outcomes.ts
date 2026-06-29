import "server-only";

/**
 * load-experiment-outcomes (2026-06-25, Sprint 3) — the I/O edge that turns the
 * proof ledger (ShippedChangeRecord[]) into the dimension-keyed SettledOutcome[]
 * the pure experiment-prior consumes. Fail-soft → [] (no evidence → no learning).
 * Reads are ambient-tenant (the proof store is ambient, matching the render path).
 */

import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";
import {
  canonicalMoveType,
  pageTypeFromUrl,
  queryClusterKey,
  type SettledOutcome,
} from "./experiment-prior";
import type { ProofOutcomeRow } from "@/domains/demand-graph/proof-outcome-caution";

/** Map the tenant's proof ledger into dimension-keyed outcomes. Fail-soft → []. */
export async function loadExperimentOutcomes(_tenantId: string): Promise<SettledOutcome[]> {
  let records;
  try {
    records = await loadShippedChanges();
  } catch {
    return [];
  }
  return records.map((r) => ({
    verdict: r.verdict,
    operatorVerdictOverride: r.operatorVerdictOverride,
    dims: {
      actionType: canonicalMoveType(r.actionType),
      pageType: pageTypeFromUrl(r.page),
      queryCluster: queryClusterKey(r.targetQueries?.[0]),
    },
  }));
}

/** Map the tenant's proof ledger into PAGE-keyed rows for the page-specific outcome
 *  caution (held-while-measuring / no-lift / lifted on THIS exact page). Keeps the
 *  page URL + verdict + baseline so the caution can match by page+family. Fail-soft → [].
 */
export async function loadProofOutcomeRows(_tenantId: string): Promise<ProofOutcomeRow[]> {
  let records;
  try {
    records = await loadShippedChanges();
  } catch {
    return [];
  }
  return records.map((r) => ({
    id: r.id,
    page: r.page,
    actionType: r.actionType,
    verdict: r.verdict,
    confidence: r.confidence,
    operatorVerdictOverride: r.operatorVerdictOverride,
    baselineImpressions: r.baseline?.impressions ?? 0,
  }));
}
