import type { ChangelogEntry } from "@/domains/changelog/types";
import type { ActionCluster } from "@/domains/action-clusters/types";
import type { ResolvedEvent } from "@/domains/attribution/event-resolution";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Pattern, PatternConfidence, PatternTrend } from "./types";
import { SIGNAL_TYPE_LABELS, ASSET_TYPE_LABELS } from "@/lib/constants";
import type { SignalType, AssetType } from "@/lib/constants";

/**
 * Extract patterns from changes, clusters, and resolved events.
 * Pattern key = signal_type × asset_type (deterministic grouping).
 */
export function extractPatterns(
  changes: ChangelogEntry[],
  clusters: ActionCluster[],
  resolved: ResolvedEvent[],
  opportunities: Opportunity[]
): Pattern[] {
  const changeIndex = new Map(changes.map((c) => [c.id, c]));
  const oppIndex = new Map(opportunities.map((o) => [o.id, o]));

  const clusterChangeIndex = new Map<string, Set<string>>();
  for (const cluster of clusters) {
    for (const cid of cluster.changeIds) {
      let set = clusterChangeIndex.get(cid);
      if (!set) { set = new Set(); clusterChangeIndex.set(cid, set); }
      set.add(cluster.id);
    }
  }

  const eventsByResultId = new Map<string, ResolvedEvent[]>();
  for (const re of resolved) {
    const list = eventsByResultId.get(re.event.anchor_result_id) ?? [];
    list.push(re);
    eventsByResultId.set(re.event.anchor_result_id, list);
  }

  const confirmedChangeIds = new Set<string>();
  for (const re of resolved) {
    if (re.status === "attributed" || re.status === "auto_resolved") {
      if (re.primary_change_id) confirmedChangeIds.add(re.primary_change_id);
      for (const id of re.contributing_change_ids) confirmedChangeIds.add(id);
    }
  }

  const buckets = new Map<string, ChangelogEntry[]>();
  for (const change of changes) {
    const key = `${change.signal_type}:${change.asset_type}`;
    const list = buckets.get(key) ?? [];
    list.push(change);
    buckets.set(key, list);
  }

  const patterns: Pattern[] = [];

  for (const [key, changeGroup] of buckets) {
    if (changeGroup.length < 1) continue;

    const [signalType, assetType] = key.split(":") as [SignalType, AssetType];
    const signalLabel = SIGNAL_TYPE_LABELS[signalType] ?? signalType;
    const assetLabel = ASSET_TYPE_LABELS[assetType] ?? assetType;
    const label = `${signalLabel} on ${assetLabel}`;

    const changeIds = changeGroup.map((c) => c.id);

    const clusterIdSet = new Set<string>();
    for (const cid of changeIds) {
      const clusters = clusterChangeIndex.get(cid);
      if (clusters) for (const cl of clusters) clusterIdSet.add(cl);
    }

    const relevantEvents: ResolvedEvent[] = [];
    for (const cluster of clusters) {
      if (!clusterIdSet.has(cluster.id)) continue;
      for (const eid of cluster.eventIds) {
        const evts = resolved.filter((r) => r.event.id === eid);
        relevantEvents.push(...evts);
      }
    }

    const eventIdSet = new Set(relevantEvents.map((e) => e.event.id));
    const attributed = relevantEvents.filter(
      (e) =>
        (e.status === "attributed" || e.status === "auto_resolved") &&
        hasPatternChange(e, changeIds)
    );
    const noCause = relevantEvents.filter(
      (e) =>
        e.status === "no_cause" &&
        hasPatternChange(e, changeIds)
    );

    const totalForRate = relevantEvents.length;
    const successRate = totalForRate > 0
      ? Math.round((attributed.length / totalForRate) * 100)
      : 0;
    const failureRate = totalForRate > 0
      ? Math.round((noCause.length / totalForRate) * 100)
      : 0;

    const timeDeltas: number[] = [];
    for (const re of attributed) {
      const change = re.primary_change_id
        ? changeIndex.get(re.primary_change_id)
        : null;
      if (change) {
        const delta =
          (new Date(re.event.trigger_date).getTime() -
            new Date(change.timestamp).getTime()) /
          86_400_000;
        if (delta >= 0) timeDeltas.push(delta);
      }
    }
    const avgTimeToImpact =
      timeDeltas.length > 0
        ? Math.round(timeDeltas.reduce((a, b) => a + b, 0) / timeDeltas.length)
        : 0;

    const platforms = new Set<string>();
    const geos = new Set<string>();
    const oppTypes = new Set<string>();
    for (const c of changeGroup) {
      if (c.city_targeted) geos.add(c.city_targeted);
      if (c.opportunity_id) {
        const opp = oppIndex.get(c.opportunity_id);
        if (opp) oppTypes.add(opp.intent_type);
      }
    }
    for (const re of relevantEvents) {
      platforms.add(re.event.platform);
    }

    const dates = changeGroup.map((c) => c.timestamp).sort();
    const lastSeenAt = dates[dates.length - 1];

    const allGeos = new Set<string>();
    for (const c of changes) allGeos.add(c.city_targeted ?? "");
    const patternGeos = new Set(changeGroup.map((c) => c.city_targeted).filter(Boolean));
    const untappedContexts: string[] = [];
    for (const geo of allGeos) {
      if (geo && !patternGeos.has(geo) && attributed.length >= 2) {
        untappedContexts.push(geo);
      }
    }

    const { score, confidenceBand } = scorePattern(
      attributed.length,
      relevantEvents.length,
      clusterIdSet.size,
      changeGroup.length,
      lastSeenAt
    );

    const trend = computeTrend(attributed, relevantEvents, lastSeenAt);

    patterns.push({
      id: `pattern-${key}`,
      label,
      patternKey: key,
      changeIds,
      clusterIds: [...clusterIdSet],
      eventIds: [...eventIdSet],
      executionCount: changeGroup.length,
      clustersImpacted: clusterIdSet.size,
      attributedEventCount: attributed.length,
      totalEventCount: relevantEvents.length,
      successRate,
      failureRate,
      avgTimeToImpact,
      dominantOpportunityTypes: [...oppTypes],
      dominantPlatforms: [...platforms],
      dominantGeo: [...geos],
      lastSeenAt,
      score,
      confidenceBand,
      trend,
      untappedContexts: untappedContexts.slice(0, 5),
    });
  }

  return patterns.sort((a, b) => b.score - a.score);
}

function hasPatternChange(re: ResolvedEvent, patternChangeIds: string[]): boolean {
  const set = new Set(patternChangeIds);
  if (re.primary_change_id && set.has(re.primary_change_id)) return true;
  for (const id of re.contributing_change_ids) {
    if (set.has(id)) return true;
  }
  return false;
}

function scorePattern(
  attributed: number,
  totalEvents: number,
  clusters: number,
  executions: number,
  lastSeenAt: string
): { score: number; confidenceBand: PatternConfidence } {
  const successRate = totalEvents > 0 ? attributed / totalEvents : 0;
  const recencyDays = Math.max(
    0,
    (Date.now() - new Date(lastSeenAt).getTime()) / 86_400_000
  );
  const recency = Math.max(0, 100 - recencyDays * 2);

  const score = Math.round(
    successRate * 100 * 0.35 +
      Math.min(100, clusters * 20) * 0.2 +
      Math.min(100, attributed * 15) * 0.2 +
      recency * 0.1 +
      Math.min(100, executions * 10) * 0.15
  );

  const confidenceBand: PatternConfidence =
    attributed >= 3 && successRate >= 0.5
      ? "high"
      : attributed >= 1
        ? "medium"
        : "low";

  return { score: Math.min(100, score), confidenceBand };
}

function computeTrend(
  attributed: ResolvedEvent[],
  all: ResolvedEvent[],
  lastSeenAt: string
): PatternTrend {
  if (attributed.length === 0) return "new";

  const now = Date.now();
  const recentCutoff = now - 14 * 86_400_000;
  const recentAttributed = attributed.filter(
    (e) => new Date(e.event.trigger_date).getTime() >= recentCutoff
  );
  const recentAll = all.filter(
    (e) => new Date(e.event.trigger_date).getTime() >= recentCutoff
  );

  if (recentAll.length === 0) {
    const daysSinceLastSeen =
      (now - new Date(lastSeenAt).getTime()) / 86_400_000;
    return daysSinceLastSeen > 21 ? "declining" : "stable";
  }

  const recentRate =
    recentAll.length > 0 ? recentAttributed.length / recentAll.length : 0;
  const overallRate = all.length > 0 ? attributed.length / all.length : 0;

  if (recentRate > overallRate + 0.1) return "improving";
  if (recentRate < overallRate - 0.1) return "declining";
  return "stable";
}
