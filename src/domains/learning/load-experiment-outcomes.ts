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
