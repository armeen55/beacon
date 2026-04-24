/**
 * Prioritizer for Phase v6 Commit 4 (2026-04-23).
 *
 * Pure function. Takes an unranked list of RecommendationCandidate (from
 * generate.ts) and splits it into two surfaces:
 *
 *   - queue: ranked work items (Create / Strengthen / Target).
 *     Top-5 → tier "now"; next 5 → "this week"; rest → "later".
 *   - watchlist: passive items (Watch). Unranked within; the queue has
 *     primacy.
 *
 * The rubric is intentionally transparent. No hidden ML scoring. Each
 * recommendation carries a `reasoning` string that names the actual
 * signals driving its position — the operator should be able to read
 * one sentence and trust the ordering.
 *
 * Scoring:
 *   score = severity
 *         + clusterSizeBonus
 *         + competitorPressureBonus
 *         + recentSignalBonus
 *         - effortPenalty
 *
 *   severity:                 high=3 / medium=2 / low=1
 *   clusterSize:              min(affectedPromptIds.length - 1, 5)
 *                             (caps at +5 so a 20-prompt cluster doesn't
 *                             dominate the whole queue)
 *   competitorPressure:       +3 when any single competitor is primary on
 *                             ≥50% of affected prompts (measured via
 *                             evidence.primaryCompetitors[0])
 *                             +2 when fragmented on ≥1 affected prompt
 *                             0 otherwise
 *   recentSignal:             +1 when evidence.maxSignalStrength ≥ 60
 *   effortPenalty:            low=0 / medium=1 / high=2
 *
 * Tie-breaks: higher evidence.promptCount wins; then lower effort; then
 * stableKey asc (deterministic).
 */

import type {
  RecommendationCandidate,
  RecommendationSeverity,
  RecommendationEffort,
  RecommendationPrimaryCompetitor,
} from "./generate";

export type PrioritizedRecommendationTier = "now" | "this_week" | "later";

export type PrioritizedRecommendation = RecommendationCandidate & {
  /** Final rubric score. Exposed so the UI can show it if ever useful;
   *  reasoning is the primary justification surface, not the number. */
  score: number;
  tier: PrioritizedRecommendationTier;
  /** 1-indexed position in the queue (1 is top). */
  rank: number;
  /** One-sentence operator-facing justification for the position. Names
   *  the specific signals that drove ranking (severity, cluster size,
   *  competitor-primary, etc). */
  reasoning: string;
};

export type PrioritizeRecommendationsResult = {
  queue: PrioritizedRecommendation[];
  watchlist: RecommendationCandidate[];
};

const NOW_TIER_CUTOFF = 5;
const WEEK_TIER_CUTOFF = 10;
const CLUSTER_SIZE_BONUS_CAP = 5;
const COMPETITOR_PRIMARY_BONUS = 3;
const FRAGMENTED_BONUS = 2;
const RECENT_SIGNAL_THRESHOLD = 60;
const RECENT_SIGNAL_BONUS = 1;

const SEVERITY_WEIGHT: Record<RecommendationSeverity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const EFFORT_PENALTY: Record<RecommendationEffort, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function competitorPressureBonus(candidate: RecommendationCandidate): number {
  const top: RecommendationPrimaryCompetitor | undefined =
    candidate.evidence.primaryCompetitors[0];
  if (
    top &&
    top.totalAffectedPrompts > 0 &&
    top.promptsWherePrimary / top.totalAffectedPrompts >= 0.5
  ) {
    return COMPETITOR_PRIMARY_BONUS;
  }
  if (candidate.evidence.fragmentedPromptCount > 0) {
    return FRAGMENTED_BONUS;
  }
  return 0;
}

function clusterSizeBonus(candidate: RecommendationCandidate): number {
  const extra = candidate.evidence.promptCount - 1;
  if (extra <= 0) return 0;
  return Math.min(extra, CLUSTER_SIZE_BONUS_CAP);
}

function recentSignalBonus(candidate: RecommendationCandidate): number {
  return candidate.evidence.maxSignalStrength >= RECENT_SIGNAL_THRESHOLD
    ? RECENT_SIGNAL_BONUS
    : 0;
}

function scoreCandidate(candidate: RecommendationCandidate): number {
  return (
    SEVERITY_WEIGHT[candidate.severity] +
    clusterSizeBonus(candidate) +
    competitorPressureBonus(candidate) +
    recentSignalBonus(candidate) -
    EFFORT_PENALTY[candidate.effort]
  );
}

function buildReasoning(candidate: RecommendationCandidate): string {
  const parts: string[] = [];
  const sevLabel =
    candidate.severity === "high"
      ? "High severity"
      : candidate.severity === "medium"
        ? "Medium severity"
        : "Low severity";
  parts.push(sevLabel);

  if (candidate.evidence.promptCount > 1) {
    parts.push(`${candidate.evidence.promptCount} affected prompts`);
  }

  const top = candidate.evidence.primaryCompetitors[0];
  if (
    top &&
    top.totalAffectedPrompts > 0 &&
    top.promptsWherePrimary / top.totalAffectedPrompts >= 0.5
  ) {
    const share = Math.round(
      (top.promptsWherePrimary / top.totalAffectedPrompts) * 100,
    );
    parts.push(
      `${top.name} is primary on ${top.promptsWherePrimary} of ${top.totalAffectedPrompts} (${share}%)`,
    );
  } else if (candidate.evidence.fragmentedPromptCount > 0) {
    parts.push(
      `${candidate.evidence.fragmentedPromptCount} prompt${candidate.evidence.fragmentedPromptCount === 1 ? "" : "s"} fragmented`,
    );
  } else if (candidate.evidence.dominantCompetitors.length > 0) {
    parts.push(
      `competitors present (${candidate.evidence.dominantCompetitors.slice(0, 2).join(", ")})`,
    );
  }

  if (candidate.effort !== "medium") {
    parts.push(
      candidate.effort === "low" ? "low effort" : "high effort",
    );
  }

  return parts.join("; ") + ".";
}

function assignTier(rank: number): PrioritizedRecommendationTier {
  if (rank <= NOW_TIER_CUTOFF) return "now";
  if (rank <= WEEK_TIER_CUTOFF) return "this_week";
  return "later";
}

/** Stable ordering. Higher score first; more affected prompts first;
 *  lower effort first; then stableKey asc for determinism. */
function compareCandidates(
  a: RecommendationCandidate & { _score: number },
  b: RecommendationCandidate & { _score: number },
): number {
  if (b._score !== a._score) return b._score - a._score;
  if (b.evidence.promptCount !== a.evidence.promptCount) {
    return b.evidence.promptCount - a.evidence.promptCount;
  }
  const effortOrder = EFFORT_PENALTY;
  if (effortOrder[a.effort] !== effortOrder[b.effort]) {
    return effortOrder[a.effort] - effortOrder[b.effort];
  }
  return a.stableKey.localeCompare(b.stableKey);
}

export function prioritizeRecommendations(
  candidates: ReadonlyArray<RecommendationCandidate>,
): PrioritizeRecommendationsResult {
  const watchlist: RecommendationCandidate[] = [];
  const queueSource: Array<RecommendationCandidate & { _score: number }> = [];

  for (const c of candidates) {
    if (c.type === "watch_winning_cluster") {
      watchlist.push(c);
      continue;
    }
    queueSource.push({ ...c, _score: scoreCandidate(c) });
  }

  queueSource.sort(compareCandidates);

  const queue: PrioritizedRecommendation[] = queueSource.map((c, i) => {
    const rank = i + 1;
    const { _score, ...rest } = c;
    return {
      ...rest,
      score: _score,
      rank,
      tier: assignTier(rank),
      reasoning: buildReasoning(c),
    };
  });

  return { queue, watchlist };
}
