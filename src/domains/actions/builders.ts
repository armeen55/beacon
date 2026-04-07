import type { ActionCluster } from "@/domains/action-clusters/types";
import type { Pattern } from "@/domains/patterns/types";
import type {
  ActionItem,
  ActionType,
  ActionBucket,
  PersistedActionState,
  FollowThroughStatus,
} from "./types";
import { scoreAction, computeStalenessBand } from "./scoring";

/**
 * Build the action queue from clusters + patterns + persisted operator state.
 * Each cluster produces exactly one primary action.
 * Replicate actions are enriched with pattern intelligence.
 */
export function buildActionQueue(
  clusters: ActionCluster[],
  persistedStates: PersistedActionState[],
  patterns: Pattern[] = [],
  nowMs: number = Date.now()
): ActionItem[] {
  const stateIndex = new Map(persistedStates.map((s) => [s.actionId, s]));
  const patternByCluster = buildPatternClusterIndex(patterns);

  return clusters
    .map((cluster) =>
      buildAction(cluster, stateIndex, patternByCluster, patterns, nowMs)
    )
    .sort((a, b) => b.priorityScore - a.priorityScore || b.urgency - a.urgency);
}

function buildPatternClusterIndex(
  patterns: Pattern[]
): Map<string, Pattern> {
  const index = new Map<string, Pattern>();
  for (const p of patterns) {
    for (const cid of p.clusterIds) {
      const existing = index.get(cid);
      if (!existing || p.score > existing.score) {
        index.set(cid, p);
      }
    }
  }
  return index;
}

function buildAction(
  cluster: ActionCluster,
  stateIndex: Map<string, PersistedActionState>,
  patternByCluster: Map<string, Pattern>,
  allPatterns: Pattern[],
  nowMs: number
): ActionItem {
  const bestPattern = patternByCluster.get(cluster.id) ?? null;
  const actionType = deriveActionType(cluster, bestPattern);
  const bucket = deriveBucket(cluster, actionType, bestPattern);
  const { priorityScore, urgency } = scoreAction(cluster, actionType, bucket);
  const stalenessBand = computeStalenessBand(cluster.timeWindow.latest, nowMs);

  const actionId = `action-${cluster.id}`;
  const persisted = stateIndex.get(actionId);
  const operatorState = persisted?.state ?? "new";

  const followThrough = operatorState === "done"
    ? computeFollowThrough(cluster, persisted, nowMs)
    : null;

  let adjustedPriority = priorityScore;
  if (bestPattern && actionType === "replicate_pattern") {
    adjustedPriority = Math.min(
      100,
      priorityScore + Math.round(bestPattern.score * 0.15)
    );
  }

  return {
    id: actionId,
    clusterId: cluster.id,
    clusterLabel: cluster.label,
    title: deriveTitle(cluster, actionType, bestPattern),
    actionType,
    bucket,
    priorityScore: adjustedPriority,
    urgency,
    confidenceBand: cluster.confidenceBand,
    status: operatorState,
    whyNow: deriveWhyNow(cluster, actionType, bestPattern),
    expectedOutcome: deriveExpectedOutcome(actionType, cluster, bestPattern),
    blockingIssue: deriveBlockingIssue(cluster),
    recommendedScope: deriveScope(cluster, actionType),
    supportingEventIds: cluster.eventIds,
    supportingChangeIds: cluster.confirmedChangeIds,
    recommendedOpportunityIds: cluster.opportunityId ? [cluster.opportunityId] : [],
    recommendedPatternKeys: cluster.dominantChangePatterns,
    resolutionCriteria: deriveResolutionCriteria(actionType, cluster),
    createdAtComputed: new Date(nowMs).toISOString(),
    stalenessBand,
    followThrough,
    patternId: bestPattern?.id ?? null,
    patternLabel: bestPattern?.label ?? null,
    patternScore: bestPattern?.score ?? null,
    patternSuccessRate: bestPattern?.successRate ?? null,
    similarContexts: bestPattern?.untappedContexts ?? [],
  };
}

function deriveActionType(
  cluster: ActionCluster,
  pattern: Pattern | null
): ActionType {
  switch (cluster.status) {
    case "review_now":
      return "review_cluster";
    case "working": {
      if (pattern && pattern.score >= 40 && pattern.successRate >= 30) {
        return "replicate_pattern";
      }
      return cluster.confirmedChangeIds.length >= 2
        ? "replicate_pattern"
        : "monitor_cluster";
    }
    case "fix_data":
      return cluster.noCandidateEventCount > cluster.rejectedOnlyEventCount
        ? "fix_changelog_coverage"
        : "fix_matching_quality";
    case "investigate_external":
      return "investigate_external";
    case "monitor_only":
      return "monitor_cluster";
    case "low_signal":
      return "deprioritize_pattern";
  }
}

function deriveBucket(
  cluster: ActionCluster,
  actionType: ActionType,
  pattern: Pattern | null
): ActionBucket {
  if (actionType === "deprioritize_pattern") return "deprioritized";
  if (actionType === "monitor_cluster") return "monitor";

  if (actionType === "fix_changelog_coverage" || actionType === "fix_matching_quality") {
    return cluster.noCandidateEventCount > 3 ? "do_now" : "system_fix";
  }

  if (actionType === "investigate_external") return "system_fix";

  if (actionType === "review_cluster") {
    return cluster.urgency >= 50 ? "do_now" : "do_this_week";
  }

  if (actionType === "replicate_pattern") {
    if (pattern && pattern.confidenceBand === "high" && pattern.successRate >= 50) {
      return "do_now";
    }
    return cluster.attributedEventCount >= 3 ? "do_now" : "do_this_week";
  }

  if (actionType === "expand_adjacent_opportunity") return "do_this_week";

  return "do_this_week";
}

function deriveTitle(
  cluster: ActionCluster,
  actionType: ActionType,
  pattern: Pattern | null
): string {
  const label = cluster.label;
  switch (actionType) {
    case "review_cluster":
      return `Review "${label}" — ${cluster.pendingEventCount} event${cluster.pendingEventCount !== 1 ? "s" : ""} pending`;
    case "replicate_pattern":
      if (pattern) {
        return `Replicate "${pattern.label}" — ${pattern.successRate}% success, ${pattern.clustersImpacted} clusters impacted`;
      }
      return `Replicate "${label}" pattern — ${cluster.attributedEventCount} events confirmed`;
    case "expand_adjacent_opportunity":
      return `Expand "${label}" to adjacent opportunities`;
    case "fix_changelog_coverage":
      return `Fix changelog gaps for "${label}" — ${cluster.noCandidateEventCount} events unlinked`;
    case "fix_matching_quality":
      return `Improve matching for "${label}" — weak candidate quality`;
    case "investigate_external":
      return `Investigate external factors in "${label}" — ${cluster.rejectedOnlyEventCount} events unexplained`;
    case "monitor_cluster":
      return `Monitor "${label}" — wait for sharper signal`;
    case "deprioritize_pattern":
      return `Deprioritize "${label}" — insufficient evidence`;
  }
}

function deriveWhyNow(
  cluster: ActionCluster,
  actionType: ActionType,
  pattern: Pattern | null
): string {
  switch (actionType) {
    case "review_cluster":
      return `${cluster.pendingEventCount} outcome events have plausible candidate causes but no human decision. Reviewing now unblocks learning.`;
    case "replicate_pattern":
      if (pattern) {
        const parts = [
          `Pattern "${pattern.label}" has ${pattern.successRate}% success rate across ${pattern.clustersImpacted} cluster${pattern.clustersImpacted !== 1 ? "s" : ""}.`,
        ];
        if (pattern.untappedContexts.length > 0) {
          parts.push(
            `Untapped in: ${pattern.untappedContexts.slice(0, 3).join(", ")}.`
          );
        }
        if (pattern.trend === "improving") {
          parts.push("Trend is improving.");
        }
        return parts.join(" ");
      }
      return `${cluster.confirmedChangeIds.length} changes confirmed across ${cluster.attributedEventCount} events. Strong evidence this pattern works.`;
    case "expand_adjacent_opportunity":
      return `Working cluster with opportunity linkage. Extending to adjacent topics could multiply impact.`;
    case "fix_changelog_coverage":
      return `${cluster.noCandidateEventCount} events can't be attributed because no changelog entries match. Attribution is blocked.`;
    case "fix_matching_quality":
      return `Candidates exist but matching quality is poor. Improving topic/platform alignment would sharpen attribution.`;
    case "investigate_external":
      return `${cluster.rejectedOnlyEventCount} events had all internal candidates rejected. Something external may be driving these outcomes.`;
    case "monitor_cluster":
      return `${cluster.eventCount} events detected but evidence is too weak or broad for actionable recommendations. Watch for pattern changes.`;
    case "deprioritize_pattern":
      return `Less than 2 events with no strong signal. Not worth operator attention right now.`;
  }
}

function deriveExpectedOutcome(
  actionType: ActionType,
  cluster: ActionCluster,
  pattern: Pattern | null
): string {
  switch (actionType) {
    case "review_cluster":
      return `Resolve ${cluster.pendingEventCount} pending events. Attribution evidence grows. Cluster moves to "working" or "no cause."`;
    case "replicate_pattern":
      if (pattern && pattern.avgTimeToImpact > 0) {
        return `Apply "${pattern.label}" to new contexts. Based on history, expect evidence in ~${pattern.avgTimeToImpact} days.`;
      }
      return `Create similar changes for adjacent topics. Expect new outcome events within 1-2 weeks if the pattern holds.`;
    case "expand_adjacent_opportunity":
      return `New opportunities created from proven cluster. Broadens coverage with evidence-backed strategy.`;
    case "fix_changelog_coverage":
      return `Logging missing changes enables candidate discovery. ${cluster.noCandidateEventCount} events become attributable.`;
    case "fix_matching_quality":
      return `Better topic/platform metadata on changes improves matching. Fewer false negatives in candidate discovery.`;
    case "investigate_external":
      return `Identify whether algorithm updates, PR coverage, or competitor moves explain the outcomes. Document findings.`;
    case "monitor_cluster":
      return `No immediate action. Check back when event count grows or patterns sharpen.`;
    case "deprioritize_pattern":
      return `Remove from active queue. Revisit only if evidence accumulates.`;
  }
}

function deriveBlockingIssue(cluster: ActionCluster): string | null {
  if (cluster.noCandidateEventCount > cluster.eventCount * 0.5) {
    return `${cluster.noCandidateEventCount} of ${cluster.eventCount} events have no candidate causes — changelog coverage gap`;
  }
  if (cluster.rejectedOnlyEventCount > cluster.eventCount * 0.5) {
    return `Most candidates rejected — possible external factors or incomplete changelog`;
  }
  return null;
}

function deriveScope(cluster: ActionCluster, actionType: ActionType): string {
  const parts: string[] = [];
  if (cluster.topicKey) parts.push(`Topic: ${cluster.topicKey}`);
  if (cluster.platformKey && cluster.platformKey !== "mixed") {
    parts.push(`Platform: ${cluster.platformKey}`);
  }
  if (cluster.geoKey && cluster.geoKey !== "—") {
    parts.push(`Geo: ${cluster.geoKey}`);
  }
  parts.push(`${cluster.eventCount} events`);
  if (cluster.changeIds.length > 0) {
    parts.push(`${cluster.changeIds.length} related changes`);
  }
  return parts.join(" · ");
}

function deriveResolutionCriteria(actionType: ActionType, cluster: ActionCluster): string {
  switch (actionType) {
    case "review_cluster":
      return `All ${cluster.pendingEventCount} pending events have confirmed or rejected causes.`;
    case "replicate_pattern":
      return `New changes created that replicate the confirmed pattern. Follow-up events detected.`;
    case "expand_adjacent_opportunity":
      return `Adjacent opportunities created and linked to new changes.`;
    case "fix_changelog_coverage":
      return `Missing changes logged. Previously unlinked events now have candidate causes.`;
    case "fix_matching_quality":
      return `Matching metadata improved. Candidate discovery finds plausible causes for previously weak matches.`;
    case "investigate_external":
      return `External cause documented or missing internal changes logged.`;
    case "monitor_cluster":
      return `Evidence accumulates — cluster either becomes actionable or is deprioritized.`;
    case "deprioritize_pattern":
      return `No action needed. Auto-promotes if new events appear.`;
  }
}

function computeFollowThrough(
  cluster: ActionCluster,
  persisted: PersistedActionState | undefined,
  nowMs: number
): FollowThroughStatus {
  if (!persisted) return "unknown";

  const completedAt = new Date(persisted.updatedAt).getTime();
  const daysSinceCompletion = (nowMs - completedAt) / 86_400_000;

  if (daysSinceCompletion < 3) return "too_early";

  const latestEventDate = new Date(cluster.timeWindow.latest).getTime();
  const hasPostCompletionEvents = latestEventDate > completedAt;

  if (!hasPostCompletionEvents) {
    return daysSinceCompletion > 14 ? "no_evidence_yet" : "too_early";
  }

  if (cluster.attributedEventCount >= 2 && cluster.status === "working") {
    return "evidence_positive";
  }

  if (cluster.attributedEventCount >= 1 || cluster.pendingEventCount > 0) {
    return "evidence_weak";
  }

  return "no_evidence_yet";
}
