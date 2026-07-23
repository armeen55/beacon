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
import { readRecordsForLearning, learningVerdictOf } from "@/domains/proof-gsc/kernel";
import type { ProofOutcomeRow } from "@/domains/demand-graph/proof-outcome-caution";

/**
 * LEARNING ELIGIBILITY GATE (kernel). Durable learning trains ONLY on MATURE,
 * cleanly-separable results: the kernel reads each record from its stored 28-day
 * window, holds an early (7/14-day) read as "measuring", and holds a change that
 * overlaps another change on the same page (confounded) as "measuring" too, so a
 * direction that can still reverse or cannot be attributed never permanently
 * biases ranking. Returns the settled verdict per record aligned 1:1 with
 * `records`, in the legacy learning vocabulary ("won" / "lost" / "measuring").
 */
function settledLearningVerdicts(records: ShippedChangeRecord[], now: Date): string[] {
  return readRecordsForLearning(records, now).map(learningVerdictOf);
}

/**
 * Apply the kernel learning gate to an explicit set of records for an explicit
 * tenant. Extracted so a cross-tenant job that already fetched every tenant's
 * rows can gate them identically to the per-tenant loader below.
 */
export async function gateRecordsToOutcomes(
  _tenantId: string,
  records: ShippedChangeRecord[],
): Promise<SettledOutcome[]> {
  const now = new Date();
  const verdicts = settledLearningVerdicts(records, now);
  return records.map((r, i) => ({
    verdict: verdicts[i],
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
  _tenantId: string,
  records: ShippedChangeRecord[],
): Promise<EffectObservation[]> {
  const now = new Date();
  const verdicts = settledLearningVerdicts(records, now);
  const out: EffectObservation[] = [];
  records.forEach((r, i) => {
    if (r.operatorVerdictOverride === "inconclusive") return; // operator pinned out of learning
    const verdict = verdicts[i];
    if (verdict !== "won" && verdict !== "lost") return; // DECIDED rows only
    const relativeLift = relativeClicksLift(r);
    if (relativeLift == null) return; // baseline too thin for an honest percent
    out.push({
      leverFamily: canonicalMoveType(r.actionType),
      pageType: pageTypeFromUrl(r.page),
      relativeLift,
      settledAt: r.measuredAt ?? r.shippedAt,
    });
  });
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
  const verdicts = settledLearningVerdicts(records, now);
  let brand = "";
  try {
    brand = getBusinessConfig(tenantId).name ?? "";
  } catch {
    brand = "";
  }
  const out: TitleSignalObservation[] = [];
  records.forEach((r, i) => {
    if (!/title/i.test(r.actionType ?? "")) return; // title-family text tests only
    const after = (r.after ?? "").trim();
    if (!after) return; // no shipped text on record -> no signals to learn from
    if (r.operatorVerdictOverride === "inconclusive") return;
    const verdict = verdicts[i];
    if (verdict !== "won" && verdict !== "lost") return; // DECIDED rows only
    const relativeLift = relativeClicksLift(r);
    if (relativeLift == null) return; // baseline too thin for an honest percent
    out.push({
      signals: scoreTitle(after, r.targetQueries?.[0] ?? "", brand).signals,
      relativeLift,
      settledAt: r.measuredAt ?? r.shippedAt,
    });
  });
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
 * Change-pattern outcome signal was removed in the Core 100K collapse (the
 * change-patterns learning module was deleted). Ranking now relies on the
 * proof-ledger win-rate + effect-size priors only. Kept as a stable no-op so
 * the ranking consumer (demand-graph/load-graph) keeps compiling; always [].
 */
export async function loadChangePatternOutcomes(): Promise<SettledOutcome[]> {
  return [];
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
  const verdicts = settledLearningVerdicts(records, now);
  return records.map((r, i) => {
    // Kernel learning gate: a non-mature or confounded verdict reads as
    // "measuring" (held while in flight) so a 7-day or unseparable signal can't
    // fire a permanent no-lift caution on a page.
    const verdict = verdicts[i];
    // Confidence only matters for the win-caution path, which requires a decided
    // verdict; downgrade to "low" whenever the verdict was held.
    const confidence = verdict === "won" || verdict === "lost" ? r.confidence : "low";
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
