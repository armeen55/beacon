import type { ActionCluster, ClusterStatus } from "./types";

export function clustersByStatus(
  clusters: ActionCluster[],
  ...statuses: ClusterStatus[]
): ActionCluster[] {
  const set = new Set(statuses);
  return clusters.filter((c) => set.has(c.status));
}

export function workingClusters(clusters: ActionCluster[]): ActionCluster[] {
  return clustersByStatus(clusters, "working");
}

export function reviewClusters(clusters: ActionCluster[]): ActionCluster[] {
  return clustersByStatus(clusters, "review_now");
}

export function fixClusters(clusters: ActionCluster[]): ActionCluster[] {
  return clustersByStatus(clusters, "fix_data", "investigate_external");
}

export function topClusters(
  clusters: ActionCluster[],
  n: number
): ActionCluster[] {
  return [...clusters]
    .sort((a, b) => b.urgency - a.urgency || b.score - a.score)
    .slice(0, n);
}

export type ClusterSummary = {
  total: number;
  working: number;
  review_now: number;
  fix_data: number;
  investigate_external: number;
  monitor_only: number;
  low_signal: number;
  totalEvents: number;
  attributedEvents: number;
  pendingEvents: number;
  avgScore: number;
};

export function summarizeClusters(
  clusters: ActionCluster[]
): ClusterSummary {
  const counts: Record<ClusterStatus, number> = {
    working: 0,
    review_now: 0,
    fix_data: 0,
    investigate_external: 0,
    monitor_only: 0,
    low_signal: 0,
  };

  let totalEvents = 0;
  let attributedEvents = 0;
  let pendingEvents = 0;
  let scoreSum = 0;

  for (const c of clusters) {
    counts[c.status]++;
    totalEvents += c.eventCount;
    attributedEvents += c.attributedEventCount;
    pendingEvents += c.pendingEventCount;
    scoreSum += c.score;
  }

  return {
    total: clusters.length,
    ...counts,
    totalEvents,
    attributedEvents,
    pendingEvents,
    avgScore: clusters.length > 0 ? Math.round(scoreSum / clusters.length) : 0,
  };
}
