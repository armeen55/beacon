/**
 * Recommendation Tracker — retroactive matching of changes to recommendation
 * patterns, producing per-pattern track records that feed back into priority
 * scoring.
 *
 * Core insight: recommendations are deterministic. If proven change A for
 * pattern P existed before change B (same pattern, different page), then B
 * was likely fulfilling a recommendation Beacon would have generated.
 * No persistence needed — computed from existing scorecard + pattern data.
 */

import type { ScorecardRowWithImpact } from "@/domains/attribution/change-impact";
import type { MinedPattern } from "@/domains/pages/playbook";
import type { ChangeVerdict, ImpactDirection } from "@/domains/attribution/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { BeaconRecommendation } from "./recommendation-engine";
import type { RecommendationResponse } from "./recommendation-response-store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecommendationMatchConfidence = "likely" | "possible";

/** Whether the tracked outcome was derived from explicit operator response or retroactive inference */
export type SignalTier = "explicit" | "inferred";

export type TrackedOutcome = {
  changeId: string;
  changeAssetName: string;
  patternId: string;
  matchConfidence: RecommendationMatchConfidence;
  priorProvenChangeId: string;
  verdict: ChangeVerdict;
  direction: ImpactDirection;
  daysSinceChange: number;
  signalTier: SignalTier;
};

export type PatternTrackRecord = {
  patternId: string;
  patternName: string;
  actedOn: number;
  validated: number;
  partial: number;
  inconclusive: number;
  noImpact: number;
  negative: number;
  tooEarly: number;
  pending: number;
  /** (validated + partial) / (total - tooEarly - pending), or 0 if denominator is 0 */
  successRate: number;
  explicitAccepted: number;
  explicitDismissed: number;
};

export type TrackRecordSummary = {
  outcomes: TrackedOutcome[];
  patternRecords: PatternTrackRecord[];
  totalActedOn: number;
  totalValidated: number;
  overallSuccessRate: number;
  totalExplicitAccepted: number;
  totalExplicitDismissed: number;
};

// ---------------------------------------------------------------------------
// Pattern matching (reused from recommendation-engine, exported for sharing)
// ---------------------------------------------------------------------------

export function matchChangeToPattern(
  change: ChangelogEntry,
  patterns: MinedPattern[],
): MinedPattern | null {
  const changeUrl = change.url?.replace(/\/+$/, "").toLowerCase();

  if (changeUrl) {
    for (const pattern of patterns) {
      if (
        pattern.sourcePages.some(
          (sp) => sp.url.replace(/\/+$/, "").toLowerCase() === changeUrl,
        )
      ) {
        return pattern;
      }
    }

    if (changeUrl.includes("/locations/")) {
      return patterns.find((p) => p.type === "city_page_module") ?? null;
    }
    if (changeUrl.includes("/services/")) {
      return patterns.find((p) => p.type === "service_page_module") ?? null;
    }
  }

  const desc = (change.change_description ?? "").toLowerCase();
  if (
    desc.includes("faq") ||
    desc.includes("schema") ||
    desc.includes("json-ld")
  ) {
    return patterns.find((p) => p.type === "faq_schema_package") ?? null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Core tracker
// ---------------------------------------------------------------------------

export function computeTrackRecord(opts: {
  impactRows: ScorecardRowWithImpact[];
  patterns: MinedPattern[];
  responses?: RecommendationResponse[];
  recommendations?: BeaconRecommendation[];
}): TrackRecordSummary {
  const { impactRows, patterns, responses = [], recommendations = [] } = opts;

  // Build pattern-level explicit signal indexes from responses + recs
  const acceptedPatterns = new Map<string, number>();
  const dismissedPatterns = new Map<string, number>();
  const acceptedRecIds = new Set<string>();
  for (const resp of responses) {
    const rec = recommendations.find((r) => r.id === resp.recId);
    if (!rec?.patternId) continue;
    if (resp.status === "accepted") {
      acceptedPatterns.set(rec.patternId, (acceptedPatterns.get(rec.patternId) ?? 0) + 1);
      acceptedRecIds.add(resp.recId);
    } else if (resp.status === "dismissed") {
      dismissedPatterns.set(rec.patternId, (dismissedPatterns.get(rec.patternId) ?? 0) + 1);
    }
  }
  // Map patternId → set of accepted rec target page URLs for explicit matching
  const acceptedTargetsByPattern = new Map<string, Set<string>>();
  for (const resp of responses) {
    if (resp.status !== "accepted") continue;
    const rec = recommendations.find((r) => r.id === resp.recId);
    if (!rec?.patternId || !rec.targetPageUrl) continue;
    const targets = acceptedTargetsByPattern.get(rec.patternId) ?? new Set();
    targets.add(rec.targetPageUrl.replace(/\/+$/, "").toLowerCase());
    acceptedTargetsByPattern.set(rec.patternId, targets);
  }

  const provenPositive = impactRows.filter(
    (r) =>
      (r.verdict === "validated" || r.verdict === "partial") &&
      r.impact.direction === "positive" &&
      r.totalEventsLinked > 0,
  );

  // Build: for each pattern, which changes proved it and when
  const provenByPattern = new Map<
    string,
    { row: ScorecardRowWithImpact; ts: number }[]
  >();
  for (const row of provenPositive) {
    const matched = matchChangeToPattern(row.change, patterns);
    if (!matched) continue;
    const existing = provenByPattern.get(matched.id) ?? [];
    existing.push({
      row,
      ts: new Date(row.change.timestamp).getTime(),
    });
    provenByPattern.set(matched.id, existing);
  }

  // For each row, check if it matches a pattern AND a prior proven change
  // for the same pattern existed before it
  const outcomes: TrackedOutcome[] = [];
  const changeUrl = (c: ChangelogEntry) =>
    c.url?.replace(/\/+$/, "").toLowerCase() ?? "";

  for (const row of impactRows) {
    if (row.change.signal_type === "measurement") continue;

    const matched = matchChangeToPattern(row.change, patterns);
    if (!matched) continue;

    const priorProven = provenByPattern.get(matched.id);
    if (!priorProven || priorProven.length === 0) continue;

    const thisTs = new Date(row.change.timestamp).getTime();
    const thisUrl = changeUrl(row.change);

    // Find a proven change for the SAME pattern on a DIFFERENT page
    // that existed BEFORE this change
    const priorOnDifferentPage = priorProven.filter(
      (p) =>
        changeUrl(p.row.change) !== thisUrl &&
        p.ts < thisTs &&
        p.row.change.id !== row.change.id,
    );

    if (priorOnDifferentPage.length === 0) continue;

    // This change likely fulfilled a recommendation
    const bestPrior = priorOnDifferentPage.sort(
      (a, b) => b.row.topScore! - a.row.topScore!,
    )[0];

    // Determine match confidence
    const sameUrlPath =
      thisUrl &&
      changeUrl(bestPrior.row.change) &&
      thisUrl.split("/").slice(0, -1).join("/") ===
        changeUrl(bestPrior.row.change).split("/").slice(0, -1).join("/");
    const confidence: RecommendationMatchConfidence = sameUrlPath
      ? "likely"
      : "possible";

    // Determine signal tier: explicit if this change's page was an accepted target
    const acceptedTargets = acceptedTargetsByPattern.get(matched.id);
    const isExplicit = acceptedTargets ? acceptedTargets.has(thisUrl) : false;

    outcomes.push({
      changeId: row.change.id,
      changeAssetName: row.change.asset_name,
      patternId: matched.id,
      matchConfidence: confidence,
      priorProvenChangeId: bestPrior.row.change.id,
      verdict: row.verdict,
      direction: row.impact.direction,
      daysSinceChange: row.daysSinceChange,
      signalTier: isExplicit ? "explicit" : "inferred",
    });
  }

  // Aggregate by pattern
  const patternMap = new Map<string, MinedPattern>();
  for (const p of patterns) patternMap.set(p.id, p);

  const byPattern = new Map<string, TrackedOutcome[]>();
  for (const o of outcomes) {
    const existing = byPattern.get(o.patternId) ?? [];
    existing.push(o);
    byPattern.set(o.patternId, existing);
  }

  const patternRecords: PatternTrackRecord[] = [];
  for (const [patternId, patternOutcomes] of byPattern) {
    const p = patternMap.get(patternId);
    const validated = patternOutcomes.filter(
      (o) => o.verdict === "validated",
    ).length;
    const partial = patternOutcomes.filter(
      (o) => o.verdict === "partial",
    ).length;
    const inconclusive = patternOutcomes.filter(
      (o) => o.verdict === "inconclusive",
    ).length;
    const noImpact = patternOutcomes.filter(
      (o) => o.verdict === "no_impact",
    ).length;
    const negative = patternOutcomes.filter(
      (o) => o.verdict === "negative",
    ).length;
    const tooEarly = patternOutcomes.filter(
      (o) => o.verdict === "too_early",
    ).length;
    const pending = patternOutcomes.filter(
      (o) => o.verdict === "pending",
    ).length;
    const measurable =
      patternOutcomes.length - tooEarly - pending;
    const successRate =
      measurable > 0 ? (validated + partial) / measurable : 0;

    patternRecords.push({
      patternId,
      patternName: p?.name ?? patternId,
      actedOn: patternOutcomes.length,
      validated,
      partial,
      inconclusive,
      noImpact,
      negative,
      tooEarly,
      pending,
      successRate,
      explicitAccepted: acceptedPatterns.get(patternId) ?? 0,
      explicitDismissed: dismissedPatterns.get(patternId) ?? 0,
    });
  }

  const totalActedOn = outcomes.length;
  const totalValidated = outcomes.filter(
    (o) => o.verdict === "validated" || o.verdict === "partial",
  ).length;
  const totalMeasurable = outcomes.filter(
    (o) => o.verdict !== "too_early" && o.verdict !== "pending",
  ).length;
  const overallSuccessRate =
    totalMeasurable > 0 ? totalValidated / totalMeasurable : 0;

  let totalExplicitAccepted = 0;
  let totalExplicitDismissed = 0;
  for (const [, count] of acceptedPatterns) totalExplicitAccepted += count;
  for (const [, count] of dismissedPatterns) totalExplicitDismissed += count;

  return {
    outcomes,
    patternRecords,
    totalActedOn,
    totalValidated,
    overallSuccessRate,
    totalExplicitAccepted,
    totalExplicitDismissed,
  };
}

/**
 * Check if a specific change was likely fulfilling a Beacon recommendation.
 */
export function wasChangeRecommended(
  changeId: string,
  trackRecord: TrackRecordSummary,
): TrackedOutcome | null {
  return trackRecord.outcomes.find((o) => o.changeId === changeId) ?? null;
}
