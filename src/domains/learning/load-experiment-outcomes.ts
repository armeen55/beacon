import "server-only";

/**
 * load-experiment-outcomes (2026-06-25, Sprint 3) — the I/O edge that turns the
 * proof ledger (ShippedChangeRecord[]) into the dimension-keyed SettledOutcome[]
 * the pure experiment-prior consumes. Fail-soft → [] (no evidence → no learning).
 * Reads are ambient-tenant (the proof store is ambient, matching the render path).
 */

import { loadShippedChanges, type ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import {
  canonicalMoveType,
  pageTypeFromUrl,
  queryClusterKey,
  type SettledOutcome,
} from "./experiment-prior";
import {
  deriveMeasurementMaturity,
  detectMeasurementOverlaps,
  type OverlapContext,
} from "@/domains/proof-gsc/measurement-maturity";
import type { ProofOutcomeRow } from "@/domains/demand-graph/proof-outcome-caution";

/**
 * Move 2 — LEARNING ELIGIBILITY GATE. Durable learning may train ONLY on MATURE
 * results (the 28-day window closed, sufficient data, clean attribution). A 7/14-day
 * provisional read, a blocked/collecting record, or an overlapping (attribution-
 * limited) measurement must NOT permanently bias ranking or block a lever — its
 * direction can still reverse at 28 days. We neutralize a non-mature verdict to
 * "measuring" (treated as in-flight, never "decided") at the load edge, so the pure
 * experiment-prior / proof-outcome-caution stay unchanged. PURE gate, no I/O added.
 */
function maturityGatedVerdict(
  r: ShippedChangeRecord,
  overlap: OverlapContext | null,
  now: Date,
): string {
  const basisWin = (r.windows ?? []).filter((w) => w.ran).sort((a, b) => b.day - a.day)[0];
  const maturity = deriveMeasurementMaturity({
    shippedAt: r.shippedAt,
    now,
    latestGscDate: null, // not consulted for the mature/non-mature decision
    windows: (r.windows ?? []).map((w) => ({ day: w.day, ran: w.ran })),
    verdict: r.verdict,
    controlsUsed: basisWin?.controlsUsed ?? 0,
    baselineImpressions: r.baseline?.impressions ?? 0,
    overlap,
    live: true,
  });
  // Only a mature, cleanly-attributed result keeps its decided verdict; everything
  // else becomes in-flight ("measuring") so it can't train the prior.
  return maturity === "mature_result" ? r.verdict : "measuring";
}

/** Map the tenant's proof ledger into dimension-keyed outcomes. Fail-soft → []. */
export async function loadExperimentOutcomes(_tenantId: string): Promise<SettledOutcome[]> {
  let records: ShippedChangeRecord[];
  try {
    records = await loadShippedChanges();
  } catch {
    return [];
  }
  const now = new Date();
  const overlaps = detectMeasurementOverlaps(records.map((r) => ({ id: r.id, path: r.path, shippedAt: r.shippedAt })));
  return records.map((r) => ({
    verdict: maturityGatedVerdict(r, overlaps.get(r.id) ?? null, now),
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
  let records: ShippedChangeRecord[];
  try {
    records = await loadShippedChanges();
  } catch {
    return [];
  }
  const now = new Date();
  const overlaps = detectMeasurementOverlaps(records.map((r) => ({ id: r.id, path: r.path, shippedAt: r.shippedAt })));
  return records.map((r) => {
    // Same maturity gate: a non-mature verdict reads as "measuring" (held while in
    // flight) so a 7-day signal can't fire a permanent no-lift caution on a page.
    const verdict = maturityGatedVerdict(r, overlaps.get(r.id) ?? null, now);
    // Confidence only matters for the win-caution path, which requires a decided
    // verdict; downgrade to "low" whenever the verdict was neutralized.
    const confidence = verdict === r.verdict ? r.confidence : "low";
    return {
      id: r.id,
      page: r.page,
      actionType: r.actionType,
      verdict,
      confidence,
      operatorVerdictOverride: r.operatorVerdictOverride,
      baselineImpressions: r.baseline?.impressions ?? 0,
    };
  });
}
