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
import { relativeClicksLift, type EffectObservation } from "./effect-size-prior";
import {
  computeTitleSignalTilts,
  retrainedTitleWeights,
  type TitleSignalObservation,
} from "./title-signal-retrain";
import {
  BASE_TITLE_SIGNAL_WEIGHTS,
  scoreTitle,
  type TitleSignalWeights,
} from "@/domains/demand-graph/ctr-title-scorer";
import { getBusinessConfig } from "@/lib/business-config";
import {
  deriveMeasurementMaturity,
  detectMeasurementOverlaps,
  measurementWindowOf,
  type OverlapContext,
} from "@/domains/proof-gsc/measurement-maturity";
import { buildShockWindows, overlappingShock, type ShockWindow } from "@/domains/proof-gsc/algorithm-weather";
import { loadDetectedChangepoints } from "@/domains/proof-gsc/algorithm-weather-store";
import { learningEligibleVerdict } from "@/domains/proof-gsc/verdict-calibration";
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
 *
 * Extended again by the parallel-trends veto (item 33): a record whose comparison
 * pages were not moving like the treated page before the ship (control-matching.ts's
 * usedFallback, persisted as ShippedChangeRecord.controlMatchWeak) is ALSO
 * neutralized to "measuring" - the diff-in-diff isn't trustworthy enough to
 * permanently bias the prior even though the window closed cleanly and no shock
 * overlapped it.
 *
 * Exported (BEACON_500 item 66) so the cross-tenant nightly aggregation
 * (global-patterns/nightly-aggregate.ts) can apply the IDENTICAL eligibility gate
 * to every tenant's ledger, rather than re-deriving a second copy of this logic.
 */
export function maturityGatedVerdict(
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
  // An intentional same-day package may earn a page-level result, but that
  // result cannot train any member lever by itself. The stable combo identity
  // is preserved by compound-actions.ts for a future bundle learner; until
  // that learner has repeated calibrated packages, individual priors stay neutral.
  if (overlap?.kind === "compound") return "measuring";
  // Additive weather gate: a mature, cleanly-attributed result STILL doesn't
  // train the prior when its own window overlapped a sitewide shock.
  const window = measurementWindowOf(r.shippedAt, r.windows ?? []);
  if (window && shockWindows.length > 0 && overlappingShock(window.start, window.end, shockWindows)) {
    return "measuring";
  }
  // Additive parallel-trends gate (item 33): same posture as the weather gate -
  // a mature, cleanly-attributed, weather-clean result STILL doesn't train the
  // prior when its own comparison pages were a fallback match.
  if (r.controlMatchWeak === true) return "measuring";
  // Fail-closed calibration quarantine (2026-07-11): even a mature, clean,
  // weather-clean, well-matched result STILL doesn't train the prior when it was
  // measured under thresholds that failed Beacon's self-test. learningEligibleVerdict
  // is the shared choke point (verdict-calibration.ts): it returns the real verdict
  // for a calibrated row and null for an uncalibrated one (every row today). A
  // neutralized decided verdict reads as "measuring", exactly like the gates above.
  const eligible = learningEligibleVerdict(r);
  if (eligible != null) return eligible;
  return r.verdict === "won" || r.verdict === "lost" ? "measuring" : r.verdict;
}

/**
 * Apply the SAME maturity/weather/parallel-trends gate to an explicit set of
 * records for an explicit tenant, without going through the ambient
 * `loadShippedChanges()` read. Extracted (item 66) so a cross-tenant job that
 * already fetched every tenant's rows (one cross-tenant query, not N ambient
 * ones) can gate them identically to the per-tenant loader below.
 */
export async function gateRecordsToOutcomes(
  tenantId: string,
  records: ShippedChangeRecord[],
): Promise<SettledOutcome[]> {
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

/**
 * R5 / N15 (2026-07-03) - map explicit ledger rows into MAGNITUDE observations
 * for the effect-size prior (effect-size-prior.ts), through the IDENTICAL
 * maturity/weather/parallel-trends gate the win-rate prior uses above (never a
 * second copy of the eligibility logic). Only DECIDED rows (gated verdict won
 * or lost, not operator-excluded) with an honest relative-clicks magnitude
 * survive; a thin baseline or an unclosed window is skipped, never fabricated.
 * Read-only over the ledger - nothing here mutates measurement history.
 */
export async function gateRecordsToEffectObservations(
  tenantId: string,
  records: ShippedChangeRecord[],
): Promise<EffectObservation[]> {
  const now = new Date();
  const overlaps = detectMeasurementOverlaps(records.map((r) => ({ id: r.id, path: r.path, shippedAt: r.shippedAt })));
  const shockWindows = await loadShockWindowsForGate(tenantId);
  const out: EffectObservation[] = [];
  for (const r of records) {
    if (r.operatorVerdictOverride === "inconclusive") continue; // operator pinned out of learning
    const verdict = maturityGatedVerdict(r, overlaps.get(r.id) ?? null, now, shockWindows);
    if (verdict !== "won" && verdict !== "lost") continue; // DECIDED rows only
    const relativeLift = relativeClicksLift(r);
    if (relativeLift == null) continue; // baseline too thin for an honest percent
    out.push({
      leverFamily: canonicalMoveType(r.actionType),
      pageType: pageTypeFromUrl(r.page),
      relativeLift,
      settledAt: r.measuredAt ?? r.shippedAt,
    });
  }
  return out;
}

/**
 * R9 (2026-07-03) - map the tenant's DECIDED title tests into title-signal
 * observations for the title-weight retrain (title-signal-retrain.ts), through
 * the IDENTICAL maturity/weather/parallel-trends gate every other learner uses.
 * A row qualifies only when it is a title-family text change (raw actionType
 * names "title") with the shipped `after` text still on record; its signals are
 * read by the SAME scorer whose weights they retrain (never a second signal
 * vocabulary). Thin/undecided rows are skipped, never fabricated.
 */
export async function gateRecordsToTitleSignalObservations(
  tenantId: string,
  records: ShippedChangeRecord[],
): Promise<TitleSignalObservation[]> {
  const now = new Date();
  const overlaps = detectMeasurementOverlaps(records.map((r) => ({ id: r.id, path: r.path, shippedAt: r.shippedAt })));
  const shockWindows = await loadShockWindowsForGate(tenantId);
  let brand = "";
  try {
    brand = getBusinessConfig(tenantId).name ?? "";
  } catch {
    brand = "";
  }
  const out: TitleSignalObservation[] = [];
  for (const r of records) {
    if (!/title/i.test(r.actionType ?? "")) continue; // title-family text tests only
    const after = (r.after ?? "").trim();
    if (!after) continue; // no shipped text on record -> no signals to learn from
    if (r.operatorVerdictOverride === "inconclusive") continue;
    const verdict = maturityGatedVerdict(r, overlaps.get(r.id) ?? null, now, shockWindows);
    if (verdict !== "won" && verdict !== "lost") continue; // DECIDED rows only
    const relativeLift = relativeClicksLift(r);
    if (relativeLift == null) continue; // baseline too thin for an honest percent
    out.push({
      signals: scoreTitle(after, r.targetQueries?.[0] ?? "", brand).signals,
      relativeLift,
      settledAt: r.measuredAt ?? r.shippedAt,
    });
  }
  return out;
}

/** Map the tenant's proof ledger into title-signal observations. Fail-soft → []. */
export async function loadTitleSignalObservations(tenantId: string): Promise<TitleSignalObservation[]> {
  let records: ShippedChangeRecord[];
  try {
    records = await loadShippedChanges();
  } catch {
    return [];
  }
  return gateRecordsToTitleSignalObservations(tenantId, records);
}

/** The retrained title-scorer weights for this tenant: base weights tilted by
 *  settled title tests, self-neutralizing (returns the base constants) on thin
 *  data or any read error. Fail-soft, never a throw. */
export async function loadRetrainedTitleWeights(tenantId: string): Promise<TitleSignalWeights> {
  try {
    const observations = await loadTitleSignalObservations(tenantId);
    return retrainedTitleWeights(computeTitleSignalTilts(observations));
  } catch {
    return BASE_TITLE_SIGNAL_WEIGHTS;
  }
}

/** Map the tenant's proof ledger into effect-size observations. Fail-soft → []. */
export async function loadEffectObservations(tenantId: string): Promise<EffectObservation[]> {
  let records: ShippedChangeRecord[];
  try {
    records = await loadShippedChanges();
  } catch {
    return [];
  }
  return gateRecordsToEffectObservations(tenantId, records);
}

/** Map the tenant's proof ledger into dimension-keyed outcomes. Fail-soft → []. */
export async function loadExperimentOutcomes(tenantId: string): Promise<SettledOutcome[]> {
  let records: ShippedChangeRecord[];
  try {
    records = await loadShippedChanges();
  } catch {
    return [];
  }
  return gateRecordsToOutcomes(tenantId, records);
}

/**
 * RANK-1 (2026-07-06) - fold the change-pattern brain's per-(signal x asset)
 * success-rate signal INTO the SAME outcome list the win-rate prior consumes, so
 * it feeds the ONE bounded multiplier (never a parallel prior). Reads the stored
 * change-patterns aggregate and reduces every pattern that cleared its own
 * >= MIN_DECIDED sample floor into synthetic decided outcomes on the actionType
 * dimension (changePatternsToOutcomes). Fail-soft -> [] : a fresh tenant with no
 * materialized patterns adds nothing, so the ranking stays byte-identical.
 * Read-only over an already-computed store; nothing here recomputes or mutates
 * measurement history.
 */
export async function loadChangePatternOutcomes(): Promise<SettledOutcome[]> {
  try {
    const { readStore } = await import("@/lib/persistence/json-store");
    const { changePatternsToOutcomes } = await import("./change-patterns");
    const patterns = await readStore<
      import("./change-patterns").ChangePattern
    >("change-patterns");
    return changePatternsToOutcomes(patterns);
  } catch {
    return [];
  }
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
