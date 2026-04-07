import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { StatCard } from "@/components/data/stat-card";
import { results, changelogEntries, opportunities } from "@/lib/seed-data.server";
import { discoverCandidates } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { detectOutcomeEvents } from "@/domains/attribution/events";
import type { OutcomeEventType } from "@/domains/attribution/events";
import { resolveEvents, computeEventIntelligence } from "@/domains/attribution/event-resolution";
import { candidateLinks, truthLabels } from "@/domains/attribution/store";
import { PLATFORM_LABELS } from "@/lib/constants";
import { computeActionClusters } from "@/domains/action-clusters/compute";
import {
  CLUSTER_STATUS_LABELS,
  CLUSTER_STATUS_COLORS,
} from "@/domains/action-clusters/types";
import type { ActionCluster } from "@/domains/action-clusters/types";

const EVENT_TYPE_LABELS: Record<OutcomeEventType, string> = {
  first_appearance: "First Appearance",
  visibility_regained: "Visibility Regained",
  mention_surge: "Mention Surge",
};

const EVENT_TYPE_COLORS: Record<OutcomeEventType, string> = {
  first_appearance: "text-status-success",
  visibility_regained: "text-accent-primary",
  mention_surge: "text-status-warning",
};

type EventReviewRow = {
  eventId: string;
  anchorResultId: string;
  eventType: OutcomeEventType;
  platform: string;
  platformKey: string;
  topic: string;
  triggerDate: string;
  description: string;
  reviewCount: number;
  totalCandidates: number;
  hasPrimary: boolean;
  clusterId: string | null;
};

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const clusterFilter =
    typeof params.cluster === "string" ? params.cluster : null;

  const { attribution } = partitionResultsByMode(results);
  const events = detectOutcomeEvents(attribution);
  const resultMap = new Map(results.map((r) => [r.id, r]));

  const { clusters, resolvedEvents } = computeActionClusters(
    results,
    changelogEntries,
    opportunities,
    candidateLinks
  );

  const activeCluster = clusterFilter
    ? clusters.find((c) => c.id === clusterFilter) ?? null
    : null;

  const clusterEventSet = activeCluster
    ? new Set(activeCluster.eventIds)
    : null;

  const triageMap = new Map<string, ReturnType<typeof triageCandidates>>();
  const candCountMap = new Map<string, number>();
  const rows: EventReviewRow[] = [];

  const eventClusterIndex = new Map<string, string>();
  for (const c of clusters) {
    for (const eid of c.eventIds) {
      eventClusterIndex.set(eid, c.id);
    }
  }

  for (const event of events) {
    if (clusterEventSet && !clusterEventSet.has(event.id)) continue;

    const anchorResult = resultMap.get(event.anchor_result_id);
    if (!anchorResult) continue;

    const candidates = discoverCandidates(anchorResult, changelogEntries, opportunities);
    candCountMap.set(event.anchor_result_id, candidates.length);

    if (candidates.length === 0) continue;

    const triage = triageCandidates(candidates);
    triageMap.set(event.anchor_result_id, triage);

    if (triage.autoResolved) continue;

    if (triage.needsReview.length > 0) {
      rows.push({
        eventId: event.id,
        anchorResultId: event.anchor_result_id,
        eventType: event.type,
        platform: PLATFORM_LABELS[event.platform] ?? event.platform,
        platformKey: event.platform,
        topic: event.topic,
        triggerDate: event.trigger_date,
        description: event.description,
        reviewCount: triage.needsReview.length,
        totalCandidates: candidates.length,
        hasPrimary: triage.primary !== null,
        clusterId: eventClusterIndex.get(event.id) ?? null,
      });
    }
  }

  const resolved = resolveEvents(events, candidateLinks, triageMap, candCountMap);
  const intel = computeEventIntelligence(resolved);

  const confirmedCount = candidateLinks.filter(
    (cl) => cl.status === "confirmed"
  ).length;

  const attributedRows = (clusterEventSet
    ? resolvedEvents.filter(
        (r) =>
          clusterEventSet.has(r.event.id) &&
          (r.status === "attributed" || r.status === "auto_resolved")
      )
    : resolved.filter(
        (r) => r.status === "attributed" || r.status === "auto_resolved"
      ));

  const noCandidateCount = resolved.filter(
    (r) => r.status === "pending" && !triageMap.has(r.event.anchor_result_id)
  ).length;

  // Group rows by topic for topic-first display
  const topicGroups = new Map<string, EventReviewRow[]>();
  for (const row of rows) {
    const list = topicGroups.get(row.topic) ?? [];
    list.push(row);
    topicGroups.set(row.topic, list);
  }
  const sortedTopicGroups = [...topicGroups.entries()]
    .sort((a, b) => b[1].length - a[1].length);

  const title = activeCluster
    ? `Review: ${activeCluster.label}`
    : "Attribution Review";
  const desc = activeCluster
    ? activeCluster.recommendationReason
    : "Review outcome events, confirm or reject candidate causes, and build attribution evidence.";

  return (
    <div>
      <PageHeader title={title} description={desc} />

      {activeCluster && <ClusterContext cluster={activeCluster} />}

      {/* Summary — focused on what the operator needs to know */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5 mb-6">
        <StatCard
          label="Pending Review"
          value={activeCluster ? activeCluster.pendingEventCount : intel.pending}
        />
        <StatCard
          label="No Candidates"
          value={activeCluster ? activeCluster.noCandidateEventCount : noCandidateCount}
        />
        <StatCard
          label="Confirmed"
          value={activeCluster ? activeCluster.attributedEventCount : intel.attributed}
        />
        <StatCard
          label="Auto-Resolved"
          value={activeCluster ? 0 : intel.auto_resolved}
        />
        <StatCard
          label="Human Labels"
          value={confirmedCount}
        />
      </div>

      {/* Cluster filter */}
      {!activeCluster && clusters.length > 0 && (
        <details className="mb-6 group">
          <summary className="text-[12px] font-medium text-muted-foreground cursor-pointer hover:text-foreground">
            Filter by cluster ({clusters.length}) ▸
          </summary>
          <div className="grid gap-2 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 mt-2">
            {clusters.map((c) => (
              <Link
                key={c.id}
                href={`/review?cluster=${encodeURIComponent(c.id)}`}
                className="rounded-md border border-border bg-surface-raised px-3 py-2 hover:bg-surface-inset transition-colors"
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wider ${CLUSTER_STATUS_COLORS[c.status]}`}
                  >
                    {CLUSTER_STATUS_LABELS[c.status]}
                  </span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {c.pendingEventCount} pending
                  </span>
                </div>
                <p className="text-[12px] font-medium truncate">{c.label}</p>
              </Link>
            ))}
          </div>
        </details>
      )}

      {rows.length === 0 && attributedRows.length === 0 ? (
        <div className="rounded-md border border-border p-8 text-center">
          <p className="text-[14px] font-medium">
            {activeCluster
              ? "No events need review in this cluster"
              : "No events need review"}
          </p>
          <p className="text-[12px] text-muted-foreground mt-1">
            {intel.auto_resolved > 0
              ? `${intel.auto_resolved} auto-resolved. ${events.length} total events.`
              : "Import data with temporal variation to detect outcome events."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Needs Review — grouped by topic */}
          {sortedTopicGroups.length > 0 && (
            <div>
              <h3 className="text-[13px] font-semibold mb-3">
                Needs Review ({rows.length} events across {sortedTopicGroups.length} topics)
              </h3>
              <div className="space-y-4">
                {sortedTopicGroups.map(([topic, topicRows]) => {
                  const platforms = [...new Set(topicRows.map((r) => r.platform))];
                  return (
                    <div
                      key={topic}
                      className="rounded-md border border-border overflow-hidden"
                    >
                      <div className="bg-surface-raised px-4 py-2 flex items-center justify-between border-b border-border">
                        <div className="flex items-center gap-2">
                          <p className="text-[13px] font-semibold">{topic}</p>
                          <span className="text-[10px] text-muted-foreground">
                            {platforms.join(" · ")}
                          </span>
                        </div>
                        <span className="text-[11px] text-status-warning font-medium tabular-nums">
                          {topicRows.length} event{topicRows.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <div className="divide-y divide-border">
                        {topicRows
                          .sort((a, b) => b.reviewCount - a.reviewCount)
                          .map((row) => (
                            <div
                              key={row.eventId}
                              className="px-4 py-2.5 flex items-center justify-between gap-3"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`text-[10px] font-semibold uppercase tracking-wider ${EVENT_TYPE_COLORS[row.eventType]}`}
                                  >
                                    {EVENT_TYPE_LABELS[row.eventType]}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground">
                                    {new Date(row.triggerDate).toLocaleDateString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                    })}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">
                                    {row.platform}
                                  </span>
                                </div>
                                <p className="text-[12px] text-muted-foreground mt-0.5 truncate max-w-[400px]">
                                  {row.description}
                                </p>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                <div className="text-right">
                                  <span className="text-[12px] tabular-nums text-status-warning font-medium">
                                    {row.reviewCount}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground">
                                    /{row.totalCandidates}
                                  </span>
                                </div>
                                {row.hasPrimary ? (
                                  <span className="text-[10px] font-medium text-status-success w-12 text-center">
                                    Primary
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-medium text-status-warning w-12 text-center">
                                    Unclear
                                  </span>
                                )}
                                <Link
                                  href={`/results/${row.anchorResultId}`}
                                  className="text-[12px] text-accent-primary hover:underline font-medium"
                                >
                                  Review
                                </Link>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Resolved */}
          {attributedRows.length > 0 && (
            <div>
              <h3 className="text-[13px] font-semibold mb-3">
                Resolved ({attributedRows.length})
              </h3>
              <div className="rounded-md border border-status-success/20 overflow-hidden divide-y divide-status-success/10">
                {attributedRows.map((r) => {
                  const change = r.primary_change_id
                    ? changelogEntries.find((c) => c.id === r.primary_change_id)
                    : null;
                  return (
                    <div
                      key={r.event.id}
                      className="px-4 py-2.5 bg-status-success/5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-semibold uppercase tracking-wider ${EVENT_TYPE_COLORS[r.event.type]}`}
                          >
                            {EVENT_TYPE_LABELS[r.event.type]}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {r.event.topic}
                          </span>
                        </div>
                        <p className="text-[12px] text-muted-foreground mt-0.5 truncate">
                          {r.status === "attributed" ? "Confirmed" : "Auto-resolved"}: {change?.asset_name ?? "—"}
                        </p>
                      </div>
                      <Link
                        href={`/results/${r.event.anchor_result_id}`}
                        className="text-[11px] text-muted-foreground hover:text-accent-primary flex-shrink-0"
                      >
                        View
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ClusterContext({ cluster }: { cluster: ActionCluster }) {
  return (
    <div className="rounded-md border border-border bg-surface-raised px-4 py-3 mb-6">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider ${CLUSTER_STATUS_COLORS[cluster.status]}`}
            >
              {CLUSTER_STATUS_LABELS[cluster.status]}
            </span>
          </div>
          <h3 className="text-[14px] font-semibold mt-0.5">{cluster.label}</h3>
        </div>
        <Link
          href="/review"
          className="text-[11px] text-muted-foreground hover:text-foreground whitespace-nowrap"
        >
          All topics
        </Link>
      </div>
      <p className="text-[12px] text-muted-foreground mb-2">
        {cluster.explanation.why}
      </p>
      <div className="grid grid-cols-4 gap-3 text-[11px]">
        <div>
          <p className="text-muted-foreground">Events</p>
          <p className="font-medium">{cluster.eventCount}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Confirmed</p>
          <p className="font-medium">{cluster.attributedEventCount}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Pending</p>
          <p className="font-medium">{cluster.pendingEventCount}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Changes</p>
          <p className="font-medium">{cluster.changeIds.length}</p>
        </div>
      </div>
    </div>
  );
}
