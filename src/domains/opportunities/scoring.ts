import type { Opportunity } from "./types";
import type { Brief } from "@/domains/briefs/types";
import type { CompetitorSnapshot } from "@/domains/competitors/types";
import type { ScoreLabel } from "@/lib/constants";

export type ScoreDimension = {
  label: string;
  value: number;
  weight: number;
  weighted: number;
};

export type OpportunityScore = {
  total: number;
  label: ScoreLabel;
  dimensions: ScoreDimension[];
};

const WEIGHTS = {
  impact: 0.30,
  confidence: 0.20,
  competitive_pressure: 0.20,
  execution_readiness: 0.15,
  evidence_momentum: 0.15,
} as const;

function scoreImpact(opp: Opportunity): number {
  const impactMap = { high: 90, medium: 60, low: 30 } as const;
  const priorityBonus = { critical: 10, high: 5, medium: 0, low: -10 } as const;
  return Math.min(100, impactMap[opp.estimated_impact] + priorityBonus[opp.priority]);
}

function scoreConfidence(opp: Opportunity): number {
  const map = { high: 90, medium: 65, low: 40, speculative: 15 } as const;
  return map[opp.confidence];
}

function scoreCompetitivePressure(
  opp: Opportunity,
  snapshots: CompetitorSnapshot[]
): number {
  if (opp.competitor_ids.length === 0) return 30;
  const relevant = snapshots.filter(
    (s) =>
      opp.competitor_ids.includes(s.competitor_id) &&
      opp.platforms.includes(s.platform)
  );
  if (relevant.length === 0) return 50;
  const avgRank =
    relevant.reduce((sum, s) => sum + (s.visibility_rank ?? 10), 0) /
    relevant.length;
  if (avgRank <= 2) return 95;
  if (avgRank <= 4) return 75;
  if (avgRank <= 6) return 55;
  return 35;
}

function scoreExecutionReadiness(
  opp: Opportunity,
  linkedBriefs: Brief[]
): number {
  if (linkedBriefs.length === 0) return 20;
  const hasActive = linkedBriefs.some(
    (b) => b.status === "in_progress" || b.status === "approved"
  );
  const hasCompleted = linkedBriefs.some((b) => b.status === "completed");
  if (hasCompleted) return 90;
  if (hasActive) return 70;
  return 40;
}

function scoreEvidenceMomentum(
  opp: Opportunity,
  linkedBriefs: Brief[]
): number {
  const completedBriefs = linkedBriefs.filter((b) => b.status === "completed");
  if (completedBriefs.length === 0) return 10;
  const outcomes = completedBriefs.flatMap((b) => b.expected_outcomes);
  if (outcomes.length === 0) return 20;
  const hits = outcomes.filter((o) => o.verdict === "hit").length;
  const partials = outcomes.filter((o) => o.verdict === "partial").length;
  const ratio = (hits + partials * 0.5) / outcomes.length;
  return Math.round(ratio * 100);
}

function getScoreLabel(total: number): ScoreLabel {
  if (total >= 80) return "act_now";
  if (total >= 60) return "strong";
  if (total >= 40) return "moderate";
  if (total >= 20) return "low";
  return "deferred";
}

export function computeOpportunityScore(
  opp: Opportunity,
  linkedBriefs: Brief[],
  competitorSnapshots: CompetitorSnapshot[]
): OpportunityScore {
  const raw = {
    impact: scoreImpact(opp),
    confidence: scoreConfidence(opp),
    competitive_pressure: scoreCompetitivePressure(opp, competitorSnapshots),
    execution_readiness: scoreExecutionReadiness(opp, linkedBriefs),
    evidence_momentum: scoreEvidenceMomentum(opp, linkedBriefs),
  };

  const dimensionLabels: Record<string, string> = {
    impact: "Impact",
    confidence: "Confidence",
    competitive_pressure: "Competitive Pressure",
    execution_readiness: "Execution Readiness",
    evidence_momentum: "Evidence Momentum",
  };

  const dimensions: ScoreDimension[] = Object.entries(raw).map(
    ([key, value]) => ({
      label: dimensionLabels[key],
      value,
      weight: WEIGHTS[key as keyof typeof WEIGHTS],
      weighted: Math.round(value * WEIGHTS[key as keyof typeof WEIGHTS]),
    })
  );

  const total = Math.round(
    dimensions.reduce((sum, d) => sum + d.weighted, 0)
  );

  return {
    total,
    label: getScoreLabel(total),
    dimensions,
  };
}
