import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Result } from "@/domains/results/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Brief } from "@/domains/briefs/types";
import type { Competitor } from "@/domains/competitors/types";
import type { AttributionConfidence, MatchStrength } from "./types";
import { computeAttribution, computeChangeVerdict, computeConfidenceScore } from "./compute";
import { ATTRIBUTION_CONFIG } from "./config";

export type EntityCount = {
  type: string;
  total: number;
  imported: number;
  seed: number;
};

export type AttributionCoverage = {
  total_results: number;
  with_attributions: number;
  without_attributions: number;
  over_attributed: number;
  attribution_density: Record<string, number>;
};

export type ConfidenceDistribution = Record<AttributionConfidence, number>;

export type FactorBreakdown = {
  factor: string;
  strong: number;
  partial: number;
  none: number;
  unknown: number;
  avg_contribution: number;
};

export type VerdictDistribution = Record<string, number>;

export type TemporalAnalysis = {
  average_days: number | null;
  median_days: number | null;
  min_days: number | null;
  max_days: number | null;
  pairs_analyzed: number;
};

export type UnlinkedStats = {
  changes_without_results: number;
  results_without_changes: number;
  changes_with_no_opportunity: number;
  changes_with_no_brief: number;
};

export type InflationRisk = {
  null_url_rate: number;
  null_geo_rate: number;
  null_topic_rate: number;
  high_confidence_with_nulls: number;
  total_pairs: number;
};

export type AttributionDiagnostics = {
  entity_counts: EntityCount[];
  coverage: AttributionCoverage;
  confidence: ConfidenceDistribution;
  factors: FactorBreakdown[];
  verdicts: VerdictDistribution;
  temporal: TemporalAnalysis;
  unlinked: UnlinkedStats;
  inflation: InflationRisk;
};

function isImported(item: { source_system?: string }): boolean {
  return !!item.source_system;
}

export function computeDiagnostics(
  allResults: Result[],
  allChanges: ChangelogEntry[],
  allOpportunities: Opportunity[],
  allBriefs: Brief[],
  allCompetitors: Competitor[]
): AttributionDiagnostics {
  const entity_counts: EntityCount[] = [
    {
      type: "Opportunities",
      total: allOpportunities.length,
      imported: allOpportunities.filter(isImported).length,
      seed: allOpportunities.filter((o) => !isImported(o)).length,
    },
    {
      type: "Briefs",
      total: allBriefs.length,
      imported: allBriefs.filter(isImported).length,
      seed: allBriefs.filter((b) => !isImported(b)).length,
    },
    {
      type: "Changes",
      total: allChanges.length,
      imported: allChanges.filter(isImported).length,
      seed: allChanges.filter((c) => !isImported(c)).length,
    },
    {
      type: "Results",
      total: allResults.length,
      imported: allResults.filter(isImported).length,
      seed: allResults.filter((r) => !isImported(r)).length,
    },
    {
      type: "Competitors",
      total: allCompetitors.length,
      imported: allCompetitors.filter(isImported).length,
      seed: allCompetitors.filter((c) => !isImported(c)).length,
    },
  ];

  const densityBuckets: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3": 0, "4+": 0 };
  let withAttr = 0;
  let withoutAttr = 0;
  let overAttr = 0;

  for (const r of allResults) {
    const count = r.attributed_changelog_ids.length;
    if (count === 0) {
      withoutAttr++;
      densityBuckets["0"]++;
    } else {
      withAttr++;
      if (count >= 4) {
        overAttr++;
        densityBuckets["4+"]++;
      } else {
        densityBuckets[String(count)]++;
      }
    }
  }

  const coverage: AttributionCoverage = {
    total_results: allResults.length,
    with_attributions: withAttr,
    without_attributions: withoutAttr,
    over_attributed: overAttr,
    attribution_density: densityBuckets,
  };

  const confidence: ConfidenceDistribution = { high: 0, medium: 0, low: 0, uncertain: 0 };
  const factorAcc: Record<string, { strong: number; partial: number; none: number; unknown: number; total_contribution: number; count: number }> = {
    platform: { strong: 0, partial: 0, none: 0, unknown: 0, total_contribution: 0, count: 0 },
    topic: { strong: 0, partial: 0, none: 0, unknown: 0, total_contribution: 0, count: 0 },
    url: { strong: 0, partial: 0, none: 0, unknown: 0, total_contribution: 0, count: 0 },
    geo: { strong: 0, partial: 0, none: 0, unknown: 0, total_contribution: 0, count: 0 },
    temporal: { strong: 0, partial: 0, none: 0, unknown: 0, total_contribution: 0, count: 0 },
    sourceCategory: { strong: 0, partial: 0, none: 0, unknown: 0, total_contribution: 0, count: 0 },
  };
  const weights = ATTRIBUTION_CONFIG.weights as Record<string, number>;
  const strengthVal = ATTRIBUTION_CONFIG.strengthValue as Record<string, number>;
  const daysList: number[] = [];

  let nullUrlPairs = 0;
  let nullGeoPairs = 0;
  let nullTopicPairs = 0;
  let highWithNulls = 0;
  let totalPairs = 0;

  for (const result of allResults) {
    for (const changeId of result.attributed_changelog_ids) {
      const change = allChanges.find((c) => c.id === changeId);
      if (!change) continue;

      totalPairs++;
      const attr = computeAttribution(change, result, allOpportunities);
      confidence[attr.confidence]++;

      const urlNull = !change.url && !result.url_measured;
      const geoNull = !change.city_targeted && !result.city;
      const topicNull = !change.topic_targeted && !result.topic;

      if (urlNull) nullUrlPairs++;
      if (geoNull) nullGeoPairs++;
      if (topicNull) nullTopicPairs++;

      if (attr.confidence === "high" && (urlNull || geoNull)) {
        highWithNulls++;
      }

      for (const [factor, strength] of Object.entries(attr.matches)) {
        const acc = factorAcc[factor];
        if (!acc) continue;
        acc[strength]++;
        acc.total_contribution += strengthVal[strength] * weights[factor];
        acc.count++;
      }

      if (attr.temporal_distance_days >= 0) {
        daysList.push(attr.temporal_distance_days);
      }
    }
  }

  const factors: FactorBreakdown[] = Object.entries(factorAcc).map(([factor, acc]) => ({
    factor,
    strong: acc.strong,
    partial: acc.partial,
    none: acc.none,
    unknown: acc.unknown,
    avg_contribution: acc.count > 0 ? Math.round((acc.total_contribution / acc.count) * 10) / 10 : 0,
  }));

  const verdicts: VerdictDistribution = { validated: 0, partial: 0, no_impact: 0, inconclusive: 0, pending: 0 };
  for (const change of allChanges) {
    const v = computeChangeVerdict(change, allResults, allOpportunities);
    verdicts[v.verdict] = (verdicts[v.verdict] ?? 0) + 1;
  }

  const sortedDays = [...daysList].sort((a, b) => a - b);
  const temporal: TemporalAnalysis = {
    average_days: daysList.length > 0 ? Math.round(daysList.reduce((s, d) => s + d, 0) / daysList.length) : null,
    median_days: sortedDays.length > 0 ? sortedDays[Math.floor(sortedDays.length / 2)] : null,
    min_days: sortedDays.length > 0 ? sortedDays[0] : null,
    max_days: sortedDays.length > 0 ? sortedDays[sortedDays.length - 1] : null,
    pairs_analyzed: daysList.length,
  };

  const changesWithResults = new Set<string>();
  for (const r of allResults) {
    for (const cid of r.attributed_changelog_ids) changesWithResults.add(cid);
  }

  const unlinked: UnlinkedStats = {
    changes_without_results: allChanges.filter((c) => !changesWithResults.has(c.id)).length,
    results_without_changes: withoutAttr,
    changes_with_no_opportunity: allChanges.filter((c) => !c.opportunity_id).length,
    changes_with_no_brief: allChanges.filter((c) => !c.brief_id).length,
  };

  const inflation: InflationRisk = {
    null_url_rate: totalPairs > 0 ? Math.round((nullUrlPairs / totalPairs) * 1000) / 10 : 0,
    null_geo_rate: totalPairs > 0 ? Math.round((nullGeoPairs / totalPairs) * 1000) / 10 : 0,
    null_topic_rate: totalPairs > 0 ? Math.round((nullTopicPairs / totalPairs) * 1000) / 10 : 0,
    high_confidence_with_nulls: highWithNulls,
    total_pairs: totalPairs,
  };

  return { entity_counts, coverage, confidence, factors, verdicts, temporal, unlinked, inflation };
}

export type CandidateDiagnostics = {
  total_results: number;
  results_with_candidates: number;
  results_without_candidates: number;
  total_candidates: number;
  avg_candidates_per_result: number;
  candidate_distribution: Record<string, number>;
  link_status: {
    confirmed: number;
    rejected: number;
    suggested: number;
  };
  truth_labels: {
    total: number;
    causal: number;
    contributing: number;
    unrelated: number;
    unknown: number;
  };
  score_calibration: {
    avg_confirmed_score: number | null;
    avg_rejected_score: number | null;
  };
  truth_agreement: {
    model_positive_human_positive: number;
    model_positive_human_negative: number;
    model_negative_human_positive: number;
    model_negative_human_negative: number;
    precision: number | null;
    recall: number | null;
  } | null;
};

import { discoverCandidates } from "./candidates";
import { getCandidateLinks, getTruthLabels } from "./store";

export async function computeCandidateDiagnostics(
  allResults: Result[],
  allChanges: ChangelogEntry[],
  allOpportunities: Opportunity[]
): Promise<CandidateDiagnostics> {
  const candidateLinks = await getCandidateLinks();
  const truthLabels = await getTruthLabels();
  let totalCandidates = 0;
  let resultsWithCandidates = 0;
  let resultsWithoutCandidates = 0;
  const distBuckets: Record<string, number> = { "0": 0, "1-2": 0, "3-5": 0, "6-10": 0 };

  for (const result of allResults) {
    const candidates = discoverCandidates(result, allChanges, allOpportunities);
    const count = candidates.length;
    totalCandidates += count;

    if (count === 0) {
      resultsWithoutCandidates++;
      distBuckets["0"]++;
    } else {
      resultsWithCandidates++;
      if (count <= 2) distBuckets["1-2"]++;
      else if (count <= 5) distBuckets["3-5"]++;
      else distBuckets["6-10"]++;
    }
  }

  const confirmed = candidateLinks.filter((cl) => cl.status === "confirmed");
  const rejected = candidateLinks.filter((cl) => cl.status === "rejected");
  const suggested = candidateLinks.filter((cl) => cl.status === "suggested");

  const confirmedScores = confirmed
    .map((cl) => {
      const result = allResults.find((r) => r.id === cl.result_id);
      const change = allChanges.find((c) => c.id === cl.change_id);
      if (!result || !change) return null;
      const attr = computeAttribution(change, result, allOpportunities);
      return computeConfidenceScore(attr.matches);
    })
    .filter((s): s is number => s !== null);

  const rejectedScores = rejected
    .map((cl) => {
      const result = allResults.find((r) => r.id === cl.result_id);
      const change = allChanges.find((c) => c.id === cl.change_id);
      if (!result || !change) return null;
      const attr = computeAttribution(change, result, allOpportunities);
      return computeConfidenceScore(attr.matches);
    })
    .filter((s): s is number => s !== null);

  const truthStats = {
    total: truthLabels.length,
    causal: truthLabels.filter((tl) => tl.relation === "causal").length,
    contributing: truthLabels.filter((tl) => tl.relation === "contributing").length,
    unrelated: truthLabels.filter((tl) => tl.relation === "unrelated").length,
    unknown: truthLabels.filter((tl) => tl.relation === "unknown").length,
  };

  let truthAgreement: CandidateDiagnostics["truth_agreement"] = null;
  const labeledPairs = truthLabels.filter((tl) => tl.relation !== "unknown");
  if (labeledPairs.length > 0) {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const label of labeledPairs) {
      const result = allResults.find((r) => r.id === label.result_id);
      const isLinked = result?.attributed_changelog_ids.includes(label.change_id) ?? false;
      const isHumanPositive = label.relation === "causal" || label.relation === "contributing";

      if (isLinked && isHumanPositive) tp++;
      else if (isLinked && !isHumanPositive) fp++;
      else if (!isLinked && isHumanPositive) fn++;
      else tn++;
    }

    truthAgreement = {
      model_positive_human_positive: tp,
      model_positive_human_negative: fp,
      model_negative_human_positive: fn,
      model_negative_human_negative: tn,
      precision: (tp + fp) > 0 ? Math.round((tp / (tp + fp)) * 1000) / 10 : null,
      recall: (tp + fn) > 0 ? Math.round((tp / (tp + fn)) * 1000) / 10 : null,
    };
  }

  return {
    total_results: allResults.length,
    results_with_candidates: resultsWithCandidates,
    results_without_candidates: resultsWithoutCandidates,
    total_candidates: totalCandidates,
    avg_candidates_per_result: allResults.length > 0
      ? Math.round((totalCandidates / allResults.length) * 10) / 10
      : 0,
    candidate_distribution: distBuckets,
    link_status: {
      confirmed: confirmed.length,
      rejected: rejected.length,
      suggested: suggested.length,
    },
    truth_labels: truthStats,
    score_calibration: {
      avg_confirmed_score: confirmedScores.length > 0
        ? Math.round(confirmedScores.reduce((s, v) => s + v, 0) / confirmedScores.length)
        : null,
      avg_rejected_score: rejectedScores.length > 0
        ? Math.round(rejectedScores.reduce((s, v) => s + v, 0) / rejectedScores.length)
        : null,
    },
    truth_agreement: truthAgreement,
  };
}

export type FactorComparison = {
  factor: string;
  confirmed_strong_pct: number;
  confirmed_unknown_pct: number;
  confirmed_avg_points: number;
  rejected_strong_pct: number;
  rejected_unknown_pct: number;
  rejected_avg_points: number;
  lift: number;
};

export type ModelReport = {
  factor_comparison: FactorComparison[];
  recommendations: string[];
  unresolved_rate: number;
  metadata_gap_rates: {
    topic_unknown_pct: number;
    url_unknown_pct: number;
    geo_unknown_pct: number;
    platform_unknown_pct: number;
  };
};

export async function computeModelReport(
  allResults: Result[],
  allChanges: ChangelogEntry[],
  allOpportunities: Opportunity[],
  cdiag: CandidateDiagnostics
): Promise<ModelReport> {
  const weights = ATTRIBUTION_CONFIG.weights as Record<string, number>;
  const strengthVal = ATTRIBUTION_CONFIG.strengthValue as Record<string, number>;
  const candidateLinks = await getCandidateLinks();
  const truthLabels = await getTruthLabels();

  type FactorAcc = { strong: number; unknown: number; total_points: number; count: number };
  const confirmedAcc: Record<string, FactorAcc> = {};
  const rejectedAcc: Record<string, FactorAcc> = {};
  for (const f of ["platform", "topic", "url", "geo", "temporal", "sourceCategory"]) {
    confirmedAcc[f] = { strong: 0, unknown: 0, total_points: 0, count: 0 };
    rejectedAcc[f] = { strong: 0, unknown: 0, total_points: 0, count: 0 };
  }

  for (const cl of candidateLinks) {
    const result = allResults.find((r) => r.id === cl.result_id);
    const change = allChanges.find((c) => c.id === cl.change_id);
    if (!result || !change) continue;

    const attr = computeAttribution(change, result, allOpportunities);
    const acc = cl.status === "confirmed" ? confirmedAcc : cl.status === "rejected" ? rejectedAcc : null;
    if (!acc) continue;

    for (const [factor, strength] of Object.entries(attr.matches)) {
      const a = acc[factor];
      if (!a) continue;
      a.count++;
      if (strength === "strong") a.strong++;
      if (strength === "unknown") a.unknown++;
      a.total_points += strengthVal[strength] * weights[factor];
    }
  }

  const factorComparison: FactorComparison[] = Object.keys(confirmedAcc).map((factor) => {
    const c = confirmedAcc[factor];
    const r = rejectedAcc[factor];
    const cAvg = c.count > 0 ? Math.round((c.total_points / c.count) * 10) / 10 : 0;
    const rAvg = r.count > 0 ? Math.round((r.total_points / r.count) * 10) / 10 : 0;
    return {
      factor,
      confirmed_strong_pct: c.count > 0 ? Math.round((c.strong / c.count) * 100) : 0,
      confirmed_unknown_pct: c.count > 0 ? Math.round((c.unknown / c.count) * 100) : 0,
      confirmed_avg_points: cAvg,
      rejected_strong_pct: r.count > 0 ? Math.round((r.strong / r.count) * 100) : 0,
      rejected_unknown_pct: r.count > 0 ? Math.round((r.unknown / r.count) * 100) : 0,
      rejected_avg_points: rAvg,
      lift: cAvg - rAvg,
    };
  });

  const allCandidatePairs: { matches: Record<string, MatchStrength> }[] = [];
  for (const result of allResults) {
    const candidates = discoverCandidates(result, allChanges, allOpportunities, { topK: 50, minScore: 0 });
    for (const cand of candidates) {
      allCandidatePairs.push({ matches: cand.attribution.matches as unknown as Record<string, MatchStrength> });
    }
  }

  const totalPairsForGaps = allCandidatePairs.length || 1;
  const metadataGaps = {
    topic_unknown_pct: Math.round(
      (allCandidatePairs.filter((p) => p.matches.topic === "unknown").length / totalPairsForGaps) * 100
    ),
    url_unknown_pct: Math.round(
      (allCandidatePairs.filter((p) => p.matches.url === "unknown").length / totalPairsForGaps) * 100
    ),
    geo_unknown_pct: Math.round(
      (allCandidatePairs.filter((p) => p.matches.geo === "unknown").length / totalPairsForGaps) * 100
    ),
    platform_unknown_pct: Math.round(
      (allCandidatePairs.filter((p) => p.matches.platform === "unknown").length / totalPairsForGaps) * 100
    ),
  };

  const unresolved = allResults.filter(
    (r) => r.attributed_changelog_ids.length === 0
  ).length;
  const unresolvedRate = allResults.length > 0
    ? Math.round((unresolved / allResults.length) * 100)
    : 0;

  const recommendations: string[] = [];

  if (metadataGaps.topic_unknown_pct > 40) {
    recommendations.push("Improve topic coverage on imported changes and results — topic is unknown in " + metadataGaps.topic_unknown_pct + "% of candidate pairs.");
  }

  if (cdiag.score_calibration.avg_confirmed_score !== null &&
      cdiag.score_calibration.avg_rejected_score !== null &&
      cdiag.score_calibration.avg_confirmed_score - cdiag.score_calibration.avg_rejected_score < 10) {
    recommendations.push("Score separation between confirmed and rejected is low — consider tightening topic matching or raising the minimum score threshold.");
  }

  if (cdiag.results_without_candidates > cdiag.total_results / 2) {
    recommendations.push("Over half of results have no candidates — check that imported changes overlap temporally with results, or widen the time window.");
  }

  if (cdiag.truth_agreement && cdiag.truth_agreement.precision !== null && cdiag.truth_agreement.precision < 50) {
    recommendations.push("Precision is below 50% — the model is linking too aggressively. Raise score threshold or tighten matching.");
  }

  if (cdiag.truth_agreement && cdiag.truth_agreement.recall !== null && cdiag.truth_agreement.recall < 50) {
    recommendations.push("Recall is below 50% — the model is missing valid links. Lower score threshold or widen time window.");
  }

  if (metadataGaps.platform_unknown_pct > 60) {
    recommendations.push("Platform matching is unknown in " + metadataGaps.platform_unknown_pct + "% of pairs — link changes to opportunities for platform context.");
  }

  if (unresolvedRate > 50) {
    recommendations.push(unresolvedRate + "% of results have no attribution — import more changes or review candidate links.");
  }

  if (recommendations.length === 0) {
    if (cdiag.truth_labels.total < 30) {
      recommendations.push("Label more truth-set pairs (current: " + cdiag.truth_labels.total + ") — aim for 30-50 to get meaningful precision/recall signals.");
    } else {
      recommendations.push("Model appears calibrated — continue reviewing and expanding the truth set.");
    }
  }

  return {
    factor_comparison: factorComparison,
    recommendations,
    unresolved_rate: unresolvedRate,
    metadata_gap_rates: metadataGaps,
  };
}
