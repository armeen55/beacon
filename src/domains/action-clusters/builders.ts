import type { Opportunity } from "@/domains/opportunities/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { ResolvedEvent } from "@/domains/attribution/event-resolution";
import type { CandidateResult } from "@/domains/attribution/candidates";
import type {
  ActionCluster,
  ClusterStatus,
  ClusterExplanation,
} from "./types";
import { scoreCluster } from "./scoring";

type CandidateMap = Map<string, CandidateResult[]>;

/**
 * Build action clusters from resolved events using deterministic heuristics.
 *
 * Grouping dimensions (in priority order):
 * 1. Shared opportunity (via candidate changes linked to the same opportunity)
 * 2. Normalized topic
 * 3. Platform
 * 4. Temporal proximity (events within same topic×platform are naturally grouped)
 */
export function buildActionClusters(
  resolved: ResolvedEvent[],
  opportunities: Opportunity[],
  changes: ChangelogEntry[],
  candidateMap: CandidateMap
): ActionCluster[] {
  const oppIndex = new Map(opportunities.map((o) => [o.id, o]));
  const changeIndex = new Map(changes.map((c) => [c.id, c]));

  const groups = groupEvents(resolved, changeIndex, candidateMap);

  const idCounts = new Map<string, number>();
  return groups
    .map((group) => {
      const cluster = buildCluster(group, oppIndex, changeIndex, candidateMap);
      const count = (idCounts.get(cluster.id) ?? 0) + 1;
      idCounts.set(cluster.id, count);
      if (count > 1) {
        cluster.id = `${cluster.id}-${count}`;
      }
      return cluster;
    })
    .sort((a, b) => b.urgency - a.urgency || b.score - a.score);
}

type EventGroup = {
  key: string;
  oppId: string | null;
  topic: string;
  platform: string;
  events: ResolvedEvent[];
};

function groupEvents(
  resolved: ResolvedEvent[],
  changeIndex: Map<string, ChangelogEntry>,
  candidateMap: CandidateMap
): EventGroup[] {
  const buckets = new Map<string, EventGroup>();

  for (const r of resolved) {
    const topic = r.event.topic;
    const platform = r.event.platform;

    const oppId = findDominantOpportunity(r, changeIndex, candidateMap);
    const key = oppId
      ? `opp:${oppId}|${platform}`
      : `topic:${normalizeTopic(topic)}|${platform}`;

    let group = buckets.get(key);
    if (!group) {
      group = { key, oppId, topic, platform, events: [] };
      buckets.set(key, group);
    }
    group.events.push(r);
  }

  return [...buckets.values()];
}

function findDominantOpportunity(
  r: ResolvedEvent,
  changeIndex: Map<string, ChangelogEntry>,
  candidateMap: CandidateMap
): string | null {
  const allChangeIds = new Set<string>();

  if (r.primary_change_id) allChangeIds.add(r.primary_change_id);
  for (const id of r.contributing_change_ids) allChangeIds.add(id);

  const candidates = candidateMap.get(r.event.anchor_result_id);
  if (candidates) {
    for (const c of candidates) allChangeIds.add(c.change.id);
  }

  const oppCounts = new Map<string, number>();
  for (const changeId of allChangeIds) {
    const change = changeIndex.get(changeId);
    if (change?.opportunity_id) {
      oppCounts.set(
        change.opportunity_id,
        (oppCounts.get(change.opportunity_id) ?? 0) + 1
      );
    }
  }

  if (oppCounts.size === 0) return null;

  return [...oppCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function normalizeTopic(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function buildCluster(
  group: EventGroup,
  oppIndex: Map<string, Opportunity>,
  changeIndex: Map<string, ChangelogEntry>,
  candidateMap: CandidateMap
): ActionCluster {
  const opp = group.oppId ? oppIndex.get(group.oppId) ?? null : null;
  const events = group.events;

  const allChangeIds = new Set<string>();
  const confirmedIds = new Set<string>();
  const rejectedIds = new Set<string>();
  const candidateIds = new Set<string>();

  for (const r of events) {
    if (r.primary_change_id) {
      allChangeIds.add(r.primary_change_id);
      confirmedIds.add(r.primary_change_id);
    }
    for (const id of r.contributing_change_ids) {
      allChangeIds.add(id);
      confirmedIds.add(id);
    }

    const cands = candidateMap.get(r.event.anchor_result_id);
    if (cands) {
      for (const c of cands) {
        allChangeIds.add(c.change.id);
        candidateIds.add(c.change.id);
      }
    }
  }

  for (const r of events) {
    if (r.status === "no_cause") {
      const cands = candidateMap.get(r.event.anchor_result_id);
      if (cands) {
        for (const c of cands) rejectedIds.add(c.change.id);
      }
    }
  }

  const unresolvedIds = new Set<string>();
  for (const id of candidateIds) {
    if (!confirmedIds.has(id) && !rejectedIds.has(id)) {
      unresolvedIds.add(id);
    }
  }

  const dates = events.map((e) => e.event.trigger_date).sort();
  const geos = new Set(
    events
      .map((e) => {
        const resultTopic = e.event.topic;
        const cityMatch = resultTopic.match(/\(([^)]+)\)/);
        return cityMatch ? cityMatch[1].trim() : null;
      })
      .filter(Boolean)
  );

  const eventTypeCounts = new Map<string, number>();
  for (const e of events) {
    eventTypeCounts.set(
      e.event.type,
      (eventTypeCounts.get(e.event.type) ?? 0) + 1
    );
  }
  const dominantEventTypes = [...eventTypeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t);

  const changePatterns = new Set<string>();
  for (const id of confirmedIds) {
    const c = changeIndex.get(id);
    if (c) changePatterns.add(c.signal_type);
  }

  const attributed = events.filter(
    (e) => e.status === "attributed" || e.status === "auto_resolved"
  ).length;
  const pending = events.filter((e) => e.status === "pending").length;
  const noCandidates = events.filter(
    (e) => e.status === "no_candidates"
  ).length;
  const noCause = events.filter((e) => e.status === "no_cause").length;

  const status = deriveStatus(events.length, attributed, pending, noCandidates, noCause);

  const clusterData = {
    eventCount: events.length,
    attributedEventCount: attributed,
    pendingEventCount: pending,
    noCandidateEventCount: noCandidates,
    rejectedOnlyEventCount: noCause,
    timeWindow: { earliest: dates[0], latest: dates[dates.length - 1] },
    confirmedChangeIds: [...confirmedIds],
    candidateChangeIds: [...candidateIds],
  };

  const { score, confidenceBand, urgency } = scoreCluster(clusterData);
  const { recommendationType, recommendationReason } = deriveRecommendation(
    status,
    events.length,
    attributed,
    pending,
    noCandidates,
    noCause,
    confirmedIds.size,
    opp
  );
  const explanation = buildExplanation(
    status,
    events,
    confirmedIds,
    candidateIds,
    noCandidates,
    noCause,
    opp
  );

  const label = opp
    ? opp.title
    : group.topic;

  const id = `cluster-${normalizeTopic(label)}-${group.platform}`.slice(0, 60);

  return {
    id,
    label,
    opportunityId: group.oppId,
    opportunityLabel: opp?.title ?? null,
    topicKey: group.topic,
    platformKey: group.platform,
    geoKey: geos.size === 1 ? [...geos][0]! : geos.size > 1 ? "mixed" : "—",
    timeWindow: { earliest: dates[0], latest: dates[dates.length - 1] },
    eventIds: events.map((e) => e.event.id),
    changeIds: [...allChangeIds],
    candidateChangeIds: [...candidateIds],
    confirmedChangeIds: [...confirmedIds],
    rejectedChangeIds: [...rejectedIds],
    unresolvedCandidateIds: [...unresolvedIds],
    eventCount: events.length,
    attributedEventCount: attributed,
    pendingEventCount: pending,
    noCandidateEventCount: noCandidates,
    rejectedOnlyEventCount: noCause,
    dominantEventTypes,
    dominantChangePatterns: [...changePatterns],
    status,
    recommendationType,
    recommendationReason,
    explanation,
    confidenceBand,
    score,
    urgency,
  };
}

function deriveStatus(
  total: number,
  attributed: number,
  pending: number,
  noCandidates: number,
  noCause: number
): ClusterStatus {
  if (total < 2 && attributed === 0 && pending <= 1) return "low_signal";

  const attributedRate = total > 0 ? attributed / total : 0;
  const noCandidateRate = total > 0 ? noCandidates / total : 0;
  const noCauseRate = total > 0 ? noCause / total : 0;

  if (attributedRate >= 0.5 && attributed >= 2) return "working";
  if (noCandidateRate >= 0.5) return "fix_data";
  if (noCauseRate >= 0.5) return "investigate_external";
  if (pending > 0) return "review_now";
  if (attributed >= 1) return "working";

  return "monitor_only";
}

function deriveRecommendation(
  status: ClusterStatus,
  total: number,
  attributed: number,
  pending: number,
  noCandidates: number,
  noCause: number,
  confirmedCount: number,
  opp: Opportunity | null
): { recommendationType: string; recommendationReason: string } {
  switch (status) {
    case "working":
      return {
        recommendationType: "double_down",
        recommendationReason:
          confirmedCount > 1
            ? `${attributed} events attributed across ${confirmedCount} confirmed changes. Repeat this pattern.`
            : `${attributed} event${attributed !== 1 ? "s" : ""} attributed. Strong signal — extend this workstream.`,
      };
    case "review_now":
      return {
        recommendationType: "review",
        recommendationReason: `${pending} event${pending !== 1 ? "s" : ""} with plausible candidates need operator review.`,
      };
    case "fix_data":
      return {
        recommendationType: "fix_metadata",
        recommendationReason: `${noCandidates} of ${total} events have no candidate causes. Changelog coverage gap.`,
      };
    case "investigate_external":
      return {
        recommendationType: "investigate",
        recommendationReason: `${noCause} event${noCause !== 1 ? "s" : ""} had all candidates rejected. External factors likely.`,
      };
    case "monitor_only":
      return {
        recommendationType: "monitor",
        recommendationReason:
          opp
            ? `Broad topic area. Monitor for sharper signal before investing review effort.`
            : `Low attribution precision. Useful for visibility tracking, not causal review.`,
      };
    case "low_signal":
      return {
        recommendationType: "wait",
        recommendationReason: "Not enough evidence to act. Wait for more data.",
      };
  }
}

function buildExplanation(
  status: ClusterStatus,
  events: ResolvedEvent[],
  confirmedIds: Set<string>,
  candidateIds: Set<string>,
  noCandidates: number,
  noCause: number,
  opp: Opportunity | null
): ClusterExplanation {
  const triggeringEventIds = events
    .filter(
      (e) =>
        e.status === "pending" ||
        e.status === "no_candidates" ||
        e.status === "attributed"
    )
    .map((e) => e.event.id)
    .slice(0, 5);

  const evidenceStrength: ClusterExplanation["evidenceStrength"] =
    confirmedIds.size >= 2
      ? "direct"
      : confirmedIds.size === 1
        ? "contributing"
        : "weak";

  let why: string;
  let toIncreaseConfidence: string;
  let toResolve: string;

  switch (status) {
    case "working":
      why = `${confirmedIds.size} change${confirmedIds.size !== 1 ? "s" : ""} confirmed as cause${confirmedIds.size !== 1 ? "s" : ""} across ${events.length} events.`;
      toIncreaseConfidence =
        "Review remaining pending events in this cluster to strengthen the pattern.";
      toResolve =
        "All events in this cluster have been resolved or can be auto-confirmed.";
      break;
    case "review_now":
      why = `${events.filter((e) => e.status === "pending").length} events have plausible candidate causes but need human review.`;
      toIncreaseConfidence =
        "Confirm or reject candidate causes for pending events.";
      toResolve =
        "Review all pending events — once resolved, this cluster will be classified as working or no-cause.";
      break;
    case "fix_data":
      why = `${noCandidates} events produced outcomes but no changelog entries match their topic/platform/timing.`;
      toIncreaseConfidence =
        "Log missing changes in the changelog or broaden topic targeting on existing changes.";
      toResolve =
        "Improve changelog coverage so candidate discovery can find plausible causes.";
      break;
    case "investigate_external":
      why = `${noCause} events had all candidate causes rejected. The outcomes are real but no logged change explains them.`;
      toIncreaseConfidence =
        "Check if external factors (algorithm updates, PR coverage, competitor changes) explain the outcome.";
      toResolve =
        "Document external cause or add missing changelog entries.";
      break;
    case "monitor_only":
      why = opp
        ? `Broad topic area with low attribution precision. Useful for trend monitoring.`
        : `Topic cluster without enough specificity for causal attribution.`;
      toIncreaseConfidence =
        "Wait for sharper events or create more targeted changes.";
      toResolve =
        "This cluster may never fully resolve — monitor for changes in pattern.";
      break;
    case "low_signal":
      why = "Too few events to form a meaningful cluster.";
      toIncreaseConfidence = "Wait for more data.";
      toResolve = "No action needed until more evidence accumulates.";
      break;
  }

  return {
    why,
    triggeringEventIds,
    supportingChangeIds: [...confirmedIds],
    evidenceStrength,
    toIncreaseConfidence,
    toResolve,
  };
}
