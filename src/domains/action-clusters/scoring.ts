import type { ActionCluster, ConfidenceBand } from "./types";

/**
 * Compute a 0-100 cluster score from transparent factors.
 * Higher = more actionable and evidence-backed.
 */
export function scoreCluster(
  cluster: Pick<
    ActionCluster,
    | "eventCount"
    | "attributedEventCount"
    | "pendingEventCount"
    | "noCandidateEventCount"
    | "rejectedOnlyEventCount"
    | "timeWindow"
    | "confirmedChangeIds"
    | "candidateChangeIds"
  >
): { score: number; confidenceBand: ConfidenceBand; urgency: number } {
  const {
    eventCount,
    attributedEventCount,
    pendingEventCount,
    noCandidateEventCount,
    rejectedOnlyEventCount,
    timeWindow,
    confirmedChangeIds,
    candidateChangeIds,
  } = cluster;

  if (eventCount === 0)
    return { score: 0, confidenceBand: "insufficient", urgency: 0 };

  const recencyDays = Math.max(
    0,
    (Date.now() - new Date(timeWindow.latest).getTime()) / 86_400_000
  );
  const recency = Math.max(0, 100 - recencyDays * 2);

  const volume = Math.min(100, eventCount * 20);

  const attributedDensity =
    eventCount > 0 ? (attributedEventCount / eventCount) * 100 : 0;

  const unresolvedDensity =
    eventCount > 0 ? (pendingEventCount / eventCount) * 100 : 0;

  const candidateQuality =
    candidateChangeIds.length > 0
      ? Math.min(
          100,
          (confirmedChangeIds.length / candidateChangeIds.length) * 100 + 20
        )
      : noCandidateEventCount > 0
        ? 10
        : 30;

  const repetition = Math.min(100, confirmedChangeIds.length * 30);

  const score = Math.round(
    recency * 0.15 +
      volume * 0.15 +
      attributedDensity * 0.25 +
      unresolvedDensity * 0.1 +
      candidateQuality * 0.2 +
      repetition * 0.15
  );

  const confidenceBand: ConfidenceBand =
    attributedEventCount >= 3 && score >= 60
      ? "high"
      : attributedEventCount >= 1 || score >= 40
        ? "medium"
        : eventCount >= 2
          ? "low"
          : "insufficient";

  // Urgency is independent: fix_data issues should surface even if score is low
  let urgency = 0;
  if (pendingEventCount > 0) urgency += pendingEventCount * 15;
  if (noCandidateEventCount > eventCount * 0.5) urgency += 40;
  if (rejectedOnlyEventCount > eventCount * 0.5) urgency += 30;
  urgency = Math.min(100, urgency + recency * 0.2);

  return { score, confidenceBand, urgency: Math.round(urgency) };
}
