/**
 * What-If Simulator — honest structural foundation.
 *
 * Connects action categories to the existing outcome database to assess
 * whether Beacon has enough historical evidence to reason about the
 * likely direction of a proposed action.
 *
 * Does NOT output fake forecasts, percentage lifts, or causal claims.
 * Reports sample sizes, directionality only when genuinely supported,
 * and "insufficient data" when evidence is thin.
 */

import "server-only";

import type { OutcomeRecord } from "./outcome-types";
import type {
  SimulationActionType,
  SimulationInput,
  SimulationResult,
  HistoricalEvidence,
  WhatIfReadiness,
} from "./whatif-types";

const ACTION_TO_REC_TYPES: Record<SimulationActionType, string[]> = {
  refresh_content: ["refresh_content", "refresh_stale_citation"],
  strengthen_structure: ["strengthen_structure"],
  improve_internal_links: ["improve_internal_links"],
  expand_page_coverage: ["topic_cluster_gap"],
  strengthen_extractability: ["strengthen_structure", "refresh_content"],
  add_faq: ["strengthen_structure"],
  add_schema: ["strengthen_structure"],
  add_city_page: ["topic_cluster_gap"],
  competitive_displacement: ["competitive_displacement"],
};

const MIN_SAMPLE_FOR_DIRECTION = 5;
const MIN_SAMPLE_FOR_STRONG = 15;

function mapOutcomesToAction(
  outcomes: OutcomeRecord[],
  actionType: SimulationActionType,
): OutcomeRecord[] {
  const recTypes = ACTION_TO_REC_TYPES[actionType] ?? [];
  return outcomes.filter((o) => {
    if (o.action_type === "recommendation_accepted" || o.action_type === "experiment_started") {
      // Match by detail text containing rec type keywords
      const detail = o.action_detail.toLowerCase();
      return recTypes.some((rt) => detail.includes(rt.replace(/_/g, " ")));
    }
    if (o.action_type === "scorecard_validated" || o.action_type === "scorecard_partial") {
      const detail = o.action_detail.toLowerCase();
      return recTypes.some((rt) => detail.includes(rt.replace(/_/g, " ")));
    }
    return false;
  });
}

/**
 * Compute historical evidence for a single action type.
 */
export function computeEvidence(
  outcomes: OutcomeRecord[],
  actionType: SimulationActionType,
): HistoricalEvidence {
  const relevant = mapOutcomesToAction(outcomes, actionType);

  if (relevant.length === 0) {
    return {
      action_type: actionType,
      sample_size: 0,
      positive_outcomes: 0,
      negative_outcomes: 0,
      neutral_outcomes: 0,
      avg_citation_delta: null,
      data_quality: "none",
    };
  }

  let positive = 0;
  let negative = 0;
  let neutral = 0;
  let deltaSum = 0;
  let deltaCount = 0;

  for (const o of relevant) {
    if (o.verdict === "validated" || o.verdict === "positive" || o.verdict === "promising") {
      positive++;
    } else if (o.verdict === "negative") {
      negative++;
    } else {
      neutral++;
    }
    if (o.citation_delta !== null) {
      deltaSum += o.citation_delta;
      deltaCount++;
    }
  }

  const quality: HistoricalEvidence["data_quality"] =
    relevant.length >= MIN_SAMPLE_FOR_STRONG ? "strong"
      : relevant.length >= MIN_SAMPLE_FOR_DIRECTION ? "moderate"
        : relevant.length >= 2 ? "thin"
          : "none";

  return {
    action_type: actionType,
    sample_size: relevant.length,
    positive_outcomes: positive,
    negative_outcomes: negative,
    neutral_outcomes: neutral,
    avg_citation_delta: deltaCount >= 3 ? Math.round((deltaSum / deltaCount) * 10) / 10 : null,
    data_quality: quality,
  };
}

/**
 * Simulate a proposed action using historical evidence.
 */
export function simulateAction(
  input: SimulationInput,
  outcomes: OutcomeRecord[],
): SimulationResult {
  const evidence = computeEvidence(outcomes, input.action_type);

  if (evidence.sample_size < MIN_SAMPLE_FOR_DIRECTION) {
    return {
      input,
      evidence,
      can_simulate: false,
      direction: "insufficient_data",
      explanation: evidence.sample_size === 0
        ? `No historical outcomes for "${input.action_type.replace(/_/g, " ")}" actions. Cannot assess likely direction.`
        : `Only ${evidence.sample_size} historical outcome${evidence.sample_size !== 1 ? "s" : ""} — too few to assess direction reliably.`,
    };
  }

  const positiveRate = evidence.positive_outcomes / evidence.sample_size;
  let direction: SimulationResult["direction"];
  let explanation: string;

  if (positiveRate >= 0.6) {
    direction = "likely_positive";
    explanation = `${Math.round(positiveRate * 100)}% of ${evidence.sample_size} similar past actions had positive outcomes.${evidence.avg_citation_delta !== null ? ` Average citation change: ${evidence.avg_citation_delta > 0 ? "+" : ""}${evidence.avg_citation_delta}.` : ""}`;
  } else if (positiveRate <= 0.3) {
    direction = "likely_negative";
    explanation = `Only ${Math.round(positiveRate * 100)}% of ${evidence.sample_size} similar past actions had positive outcomes. Consider alternative approaches.`;
  } else {
    direction = "uncertain";
    explanation = `Mixed results from ${evidence.sample_size} similar past actions (${Math.round(positiveRate * 100)}% positive). Outcome is uncertain.`;
  }

  return {
    input,
    evidence,
    can_simulate: true,
    direction,
    explanation,
  };
}

/**
 * Assess overall what-if readiness across all action types.
 */
export function assessWhatIfReadiness(
  outcomes: OutcomeRecord[],
): WhatIfReadiness {
  const allTypes: SimulationActionType[] = [
    "refresh_content", "strengthen_structure", "improve_internal_links",
    "expand_page_coverage", "strengthen_extractability", "add_faq",
    "add_schema", "add_city_page", "competitive_displacement",
  ];

  const evidenceByAction: HistoricalEvidence[] = allTypes.map((t) =>
    computeEvidence(outcomes, t),
  );

  const withEvidence = evidenceByAction.filter((e) => e.sample_size > 0).length;
  const withStrongEvidence = evidenceByAction.filter(
    (e) => e.data_quality === "strong" || e.data_quality === "moderate",
  ).length;

  let readiness: WhatIfReadiness["readiness"];
  let assessment: string;

  if (withStrongEvidence >= 3) {
    readiness = "ready";
    assessment = `${withStrongEvidence} action types have enough historical data for directional simulation.`;
  } else if (withEvidence >= 2) {
    readiness = "partial";
    assessment = `${withEvidence} action types have some historical data, but sample sizes are thin. More outcome data needed for reliable simulation.`;
  } else {
    readiness = "not_ready";
    assessment = `Only ${withEvidence} action type${withEvidence !== 1 ? "s" : ""} have any historical outcomes. What-if simulation requires more operator actions and import cycles.`;
  }

  return {
    computed_at: new Date().toISOString(),
    action_types_with_evidence: withEvidence,
    total_action_types: allTypes.length,
    total_outcomes: outcomes.length,
    readiness,
    assessment,
    evidence_by_action: evidenceByAction,
  };
}
