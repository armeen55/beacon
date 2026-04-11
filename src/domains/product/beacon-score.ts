/**
 * Beacon Score — multi-dimensional visibility health assessment.
 *
 * NOT a vanity metric. Each dimension is computed independently with
 * explicit data sufficiency checks. The composite score is only
 * produced when enough dimensions have sufficient data.
 *
 * Dimensions:
 * 1. Visibility strength (citations, mentions)
 * 2. Coverage breadth (topics, cities, stages)
 * 3. Consistency (decay stability)
 * 4. Competitive position (share vs competitors)
 * 5. Representation quality (discrepancy count)
 * 6. Local strength (geographic coverage)
 *
 * If any dimension lacks data, it reports "insufficient" and does
 * not contribute to the composite. If fewer than 4 of 6 dimensions
 * are sufficient, the composite is unavailable.
 */

import "server-only";

import type {
  ScoreDimension,
  DimensionStatus,
  BeaconScoreResult,
} from "./beacon-score-types";

const MIN_SUFFICIENT_DIMENSIONS = 4;

type ScoreInputs = {
  totalOwnedCitations: number;
  totalOwnedMentions: number;
  topicsCovered: number;
  citiesCovered: number;
  journeyStagesCovered: number;
  totalJourneyStages: number;
  decayStableCount: number;
  decayDecliningCount: number;
  decayTotal: number;
  ownedSharePct: number | null;
  competitorCount: number;
  discrepancyCount: number;
  discrepancyNotableCount: number;
  totalAnswersChecked: number;
  geoGapCount: number;
  geoCitiesWithPresence: number;
  geoTotalCities: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeVisibility(inputs: ScoreInputs): ScoreDimension {
  const cit = inputs.totalOwnedCitations;
  if (cit < 5) {
    return {
      key: "visibility",
      label: "Visibility strength",
      value: null,
      max: 100,
      status: "insufficient",
      explanation: `Only ${cit} owned citations — not enough to assess visibility strength.`,
    };
  }
  // Log scale: 5 citations = ~20, 100 = ~50, 1000 = ~75, 5000+ = ~95
  const score = clamp(Math.round(Math.log10(cit) * 25), 10, 95);
  return {
    key: "visibility",
    label: "Visibility strength",
    value: score,
    max: 100,
    status: cit >= 20 ? "sufficient" : "partial",
    explanation: `${cit.toLocaleString()} owned citations across tracked topics.`,
  };
}

function computeBreadth(inputs: ScoreInputs): ScoreDimension {
  const topics = inputs.topicsCovered;
  const cities = inputs.citiesCovered;
  const stages = inputs.journeyStagesCovered;
  const totalStages = inputs.totalJourneyStages;

  if (topics === 0) {
    return {
      key: "breadth",
      label: "Coverage breadth",
      value: null,
      max: 100,
      status: "insufficient",
      explanation: "No topic coverage data available.",
    };
  }

  const topicScore = clamp(Math.round(Math.sqrt(topics) * 15), 5, 40);
  const cityScore = clamp(Math.round(Math.sqrt(cities) * 10), 0, 30);
  const stageScore = totalStages > 0
    ? clamp(Math.round((stages / totalStages) * 30), 0, 30)
    : 0;

  const score = clamp(topicScore + cityScore + stageScore, 5, 95);
  return {
    key: "breadth",
    label: "Coverage breadth",
    value: score,
    max: 100,
    status: topics >= 3 ? "sufficient" : "partial",
    explanation: `${topics} topic${topics !== 1 ? "s" : ""}, ${cities} ${cities !== 1 ? "cities" : "city"}, ${stages}/${totalStages} journey stages.`,
  };
}

function computeConsistency(inputs: ScoreInputs): ScoreDimension {
  if (inputs.decayTotal < 3) {
    return {
      key: "consistency",
      label: "Consistency",
      value: null,
      max: 100,
      status: "insufficient",
      explanation: `Only ${inputs.decayTotal} pages with enough citation history to assess.`,
    };
  }

  const stableRate = inputs.decayTotal > 0
    ? inputs.decayStableCount / inputs.decayTotal
    : 0;
  const score = clamp(Math.round(stableRate * 95), 10, 95);

  return {
    key: "consistency",
    label: "Consistency",
    value: score,
    max: 100,
    status: inputs.decayTotal >= 5 ? "sufficient" : "partial",
    explanation: `${inputs.decayStableCount}/${inputs.decayTotal} tracked pages have stable citation momentum. ${inputs.decayDecliningCount} declining.`,
  };
}

function computeCompetitive(inputs: ScoreInputs): ScoreDimension {
  if (inputs.ownedSharePct === null) {
    return {
      key: "competitive",
      label: "Competitive position",
      value: null,
      max: 100,
      status: "insufficient",
      explanation: "Not enough data to compute competitive share.",
    };
  }

  const share = inputs.ownedSharePct;
  const score = clamp(Math.round(share * 1.5), 5, 95);

  return {
    key: "competitive",
    label: "Competitive position",
    value: score,
    max: 100,
    status: "sufficient",
    explanation: `${share}% owned citation share across tracked topics${inputs.competitorCount > 0 ? ` vs ${inputs.competitorCount} competitors` : ""}.`,
  };
}

function computeRepresentation(inputs: ScoreInputs): ScoreDimension {
  if (inputs.totalAnswersChecked < 20) {
    return {
      key: "representation",
      label: "Representation quality",
      value: null,
      max: 100,
      status: "insufficient",
      explanation: `Only ${inputs.totalAnswersChecked} AI answers checked — need at least 20 for assessment.`,
    };
  }

  // Fewer discrepancies = better score
  const notableRatio = inputs.totalAnswersChecked > 0
    ? inputs.discrepancyNotableCount / Math.max(inputs.totalAnswersChecked / 100, 1)
    : 0;
  const score = clamp(Math.round(95 - notableRatio * 30 - inputs.discrepancyCount * 5), 15, 95);

  return {
    key: "representation",
    label: "Representation quality",
    value: score,
    max: 100,
    status: "sufficient",
    explanation: `${inputs.discrepancyCount} discrepanc${inputs.discrepancyCount === 1 ? "y" : "ies"} detected (${inputs.discrepancyNotableCount} notable) across ${inputs.totalAnswersChecked} AI answers.`,
  };
}

function computeLocal(inputs: ScoreInputs): ScoreDimension {
  if (inputs.geoTotalCities < 2) {
    return {
      key: "local",
      label: "Local strength",
      value: null,
      max: 100,
      status: "insufficient",
      explanation: "Not enough geographic data to assess local strength.",
    };
  }

  const presenceRate = inputs.geoTotalCities > 0
    ? inputs.geoCitiesWithPresence / inputs.geoTotalCities
    : 0;
  const gapPenalty = Math.min(inputs.geoGapCount * 8, 40);
  const score = clamp(Math.round(presenceRate * 95 - gapPenalty), 10, 95);

  return {
    key: "local",
    label: "Local strength",
    value: score,
    max: 100,
    status: inputs.geoTotalCities >= 3 ? "sufficient" : "partial",
    explanation: `Present in ${inputs.geoCitiesWithPresence}/${inputs.geoTotalCities} tracked markets. ${inputs.geoGapCount} gap${inputs.geoGapCount !== 1 ? "s" : ""}.`,
  };
}

/**
 * Compute the full Beacon Score from all available inputs.
 */
export function computeBeaconScore(inputs: ScoreInputs): BeaconScoreResult {
  const dimensions: ScoreDimension[] = [
    computeVisibility(inputs),
    computeBreadth(inputs),
    computeConsistency(inputs),
    computeCompetitive(inputs),
    computeRepresentation(inputs),
    computeLocal(inputs),
  ];

  const sufficient = dimensions.filter((d) => d.status === "sufficient");
  const withValues = dimensions.filter((d) => d.value !== null);

  let composite: number | null = null;
  let compositeStatus: BeaconScoreResult["composite_status"] = "unavailable";

  if (sufficient.length >= MIN_SUFFICIENT_DIMENSIONS) {
    const sum = withValues.reduce((s, d) => s + d.value!, 0);
    composite = Math.round(sum / withValues.length);
    compositeStatus = "stable";
  } else if (withValues.length >= 3) {
    const sum = withValues.reduce((s, d) => s + d.value!, 0);
    composite = Math.round(sum / withValues.length);
    compositeStatus = "partial";
  }

  let summary: string;
  if (compositeStatus === "stable") {
    summary = `Beacon Score: ${composite}/100 across ${sufficient.length} dimensions with sufficient data.`;
  } else if (compositeStatus === "partial") {
    summary = `Partial Beacon Score: ${composite}/100 — only ${sufficient.length}/${dimensions.length} dimensions have full data.`;
  } else {
    summary = `Beacon Score not yet available — only ${withValues.length}/${dimensions.length} dimensions have enough data.`;
  }

  return {
    computed_at: new Date().toISOString(),
    composite,
    composite_status: compositeStatus,
    dimensions,
    sufficient_count: sufficient.length,
    total_dimensions: dimensions.length,
    summary,
  };
}
