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
  measurementWindowOf,
  type OverlapContext,
} from "@/domains/proof-gsc/measurement-maturity";
import { buildShockWindows, overlappingShock, type ShockWindow } from "@/domains/proof-gsc/algorithm-weather";
import { loadDetectedChangepoints } from "@/domains/proof-gsc/algorithm-weather-store";
import type { ProofOutcomeRow } from "@/domains/demand-graph/proof-outcome-caution";

/**
 * Algorithm-weather guard (master plan item 32) - the tenant's shock windows,
 * loaded ONCE per call and passed into every record's gate below. Fail-soft:
 * a store error or empty history means no shocks are known, so the gate falls
 * through to exactly its pre-item-32 behavior (no false quarantine from a
 * broken read). No fresh CUSUM run happens here (that is the nightly cron's
 * job, see cron-sync.ts) - this only reads what the last nightly pass found.
 */
async function loadShockWindowsForGate(tenantId: string): Promise<ShockWindow[]> {
  try {
    const changepoints = await loadDetectedChangepoints(tenantId);
    return buildShockWindows({ dailySeries: [], priorChangepoints: changepoints });
  } catch {
    return [];
  }
}

/**
 * Move 2 — LEARNING ELIGIBILITY GATE. Durable learning may train ONLY on MATURE
 * results (the 28-day window closed, sufficient data, clean attribution). A 7/14-day
 * provisional read, a blocked/collecting record, or an overlapping (attribution-
 * limited) measurement must NOT permanently bias ranking or block a lever — its
 * direction can still reverse at 28 days. We neutralize a non-mature verdict to
 * "measuring" (treated as in-flight, never "decided") at the load edge, so the pure
 * experiment-prior / proof-outcome-caution stay unchanged. PURE gate, no I/O added.
 *
 * Extended by the algorithm-weather guard (item 32): a verdict whose measurement
 * window overlapped a confirmed Google update or a detected sitewide shock is ALSO
 * neutralized to "measuring", the same way a non-mature or accidentally-overlapping
 * read already is. A shift in the whole site's baseline during the window makes the
 * diff-in-diff comparison to controls unreliable for that specific record, so it
 * must not permanently bias the prior even though the window itself closed cleanly.
 */
function maturityGatedVerdict(
  r: ShippedChangeRecord,
  overlap: OverlapContext | null,
  now: Date,
  shockWindows: ReadonlyArray<ShockWindow>,
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
  if (maturity !== "mature_result") return "measuring";
  // Additive weather gate: a mature, cleanly-attributed result STILL doesn't
  // train the prior when its own window overlapped a sitewide shock.
  const window = measurementWindowOf(r.shippedAt, r.windows ?? []);
  if (window && shockWindows.length > 0 && overlappingShock(window.start, window.end, shockWindows)) {
    return "measuring";
  }
  return r.verdict;
}

/** Map the tenant's proof ledger into dimension-keyed outcomes. Fail-soft → []. */
export async function loadExperimentOutcomes(tenantId: string): Promise<SettledOutcome[]> {
  let records: ShippedChangeRecord[];
  try {
    records = await loadShippedChanges();
  } catch {
    return [];
  }
  const now = new Date();
  const overlaps = detectMeasurementOverlaps(records.map((r) => ({ id: r.id, path: r.path, shippedAt: r.shippedAt })));
  const shockWindows = await loadShockWindowsForGate(tenantId);
  return records.map((r) => ({
    verdict: maturityGatedVerdict(r, overlaps.get(r.id) ?? null, now, shockWindows),
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
export async function loadProofOutcomeRows(tenantId: string): Promise<ProofOutcomeRow[]> {
  let records: ShippedChangeRecord[];
  try {
    records = await loadShippedChanges();
  } catch {
    return [];
  }
  const now = new Date();
  const overlaps = detectMeasurementOverlaps(records.map((r) => ({ id: r.id, path: r.path, shippedAt: r.shippedAt })));
  const shockWindows = await loadShockWindowsForGate(tenantId);
  return records.map((r) => {
    // Same maturity gate: a non-mature verdict reads as "measuring" (held while in
    // flight) so a 7-day signal can't fire a permanent no-lift caution on a page.
    const verdict = maturityGatedVerdict(r, overlaps.get(r.id) ?? null, now, shockWindows);
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
