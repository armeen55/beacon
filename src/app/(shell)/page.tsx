import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { StatCard } from "@/components/data/stat-card";
import {
  results,
  changelogEntries,
  opportunities,
  hasActiveExperiment,
  importRuns,
} from "@/lib/seed-data.server";
import { candidateLinks } from "@/domains/attribution/store";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { detectOutcomeEvents } from "@/domains/attribution/events";
import {
  resolveEvents,
  computeEventIntelligence,
  computeChangeLearning,
} from "@/domains/attribution/event-resolution";
import { discoverCandidates } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import { computeActionClusters } from "@/domains/action-clusters/compute";
import { PLATFORM_LABELS } from "@/lib/constants";

export default function DashboardPage() {
  if (hasActiveExperiment()) {
    return <TodayView />;
  }
  return <EmptyState />;
}

function TodayView() {
  const { attribution } = partitionResultsByMode(results);
  const events = detectOutcomeEvents(attribution);
  const resultMap = new Map(results.map((r) => [r.id, r]));

  const { clusters, resolvedEvents } = computeActionClusters(
    results,
    changelogEntries,
    opportunities,
    candidateLinks
  );

  const triageMap = new Map<string, ReturnType<typeof triageCandidates>>();
  const candCountMap = new Map<string, number>();

  for (const event of events) {
    const anchorResult = resultMap.get(event.anchor_result_id);
    if (!anchorResult) continue;
    const candidates = discoverCandidates(anchorResult, changelogEntries, opportunities);
    candCountMap.set(event.anchor_result_id, candidates.length);
    if (candidates.length > 0) {
      triageMap.set(event.anchor_result_id, triageCandidates(candidates));
    }
  }

  const resolved = resolveEvents(events, candidateLinks, triageMap, candCountMap);
  const intel = computeEventIntelligence(resolved);
  const changeLearning = computeChangeLearning(resolvedEvents);

  const pendingReview = resolved.filter((r) => r.status === "pending");
  const attributed = resolved.filter(
    (r) => r.status === "attributed" || r.status === "auto_resolved"
  );
  const noCandidateEvents = resolved.filter(
    (r) => r.status === "pending" && !triageMap.has(r.event.anchor_result_id)
  );

  const confirmedChanges = changeLearning.filter(
    (cl) => cl.events_attributed > 0
  );

  const recentChanges = [...changelogEntries]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);

  const fixDataClusters = clusters.filter((c) => c.status === "fix_data");

  const topReviewTopics = new Map<string, { count: number; platforms: Set<string> }>();
  for (const r of pendingReview) {
    const key = r.event.topic;
    const existing = topReviewTopics.get(key) ?? { count: 0, platforms: new Set() };
    existing.count++;
    existing.platforms.add(r.event.platform);
    topReviewTopics.set(key, existing);
  }
  const reviewTopics = [...topReviewTopics.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight">Today</h1>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Attribution triage for {results.length} results · {changelogEntries.length} changes · {events.length} outcome events
        </p>
      </div>

      {/* Knows vs Suspects */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            Beacon knows
          </p>
          <div className="space-y-0.5 text-[12px]">
            <p><span className="font-medium tabular-nums">{changelogEntries.length}</span> changes imported</p>
            <p><span className="font-medium tabular-nums">{results.length}</span> results tracked</p>
            <p><span className="font-medium tabular-nums">{events.length}</span> outcome events detected</p>
            <p><span className="font-medium tabular-nums">{intel.attributed}</span> events with confirmed cause</p>
            <p><span className="font-medium tabular-nums">{intel.auto_resolved}</span> events auto-resolved</p>
            <p><span className="font-medium tabular-nums">{candidateLinks.filter((c) => c.status === "confirmed").length}</span> confirmed candidate links</p>
          </div>
        </div>
        <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-status-warning mb-1.5">
            Beacon suspects
          </p>
          <div className="space-y-0.5 text-[12px] text-muted-foreground">
            <p><span className="tabular-nums">{intel.pending}</span> events have plausible causes (unconfirmed)</p>
            <p><span className="tabular-nums">{clusters.length}</span> topic clusters detected</p>
            <p><span className="tabular-nums">{confirmedChanges.length}</span> changes may have produced impact</p>
            <p><span className="tabular-nums">{noCandidateEvents.length}</span> events have no candidate causes</p>
          </div>
        </div>
      </div>

      {/* Review Now */}
      {reviewTopics.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[13px] font-semibold">Review Now</h2>
            <Link
              href="/review"
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              Full review queue <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-1.5">
            {reviewTopics.map(([topic, { count, platforms }]) => (
              <Link
                key={topic}
                href="/review"
                className="block rounded-md border border-status-warning/20 bg-status-warning/5 px-4 py-2.5 hover:bg-status-warning/10 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium truncate">{topic}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-muted-foreground">
                        {count} event{count !== 1 ? "s" : ""} need review
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {[...platforms].map((p) => PLATFORM_LABELS[p as keyof typeof PLATFORM_LABELS] ?? p).join(", ")}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-status-warning flex-shrink-0">
                    Review needed
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* System Blocks */}
      {fixDataClusters.length > 0 && (
        <div>
          <h2 className="text-[13px] font-semibold mb-2">System Blocks</h2>
          <div className="space-y-1.5">
            {fixDataClusters.slice(0, 3).map((c) => (
              <div
                key={c.id}
                className="rounded-md border border-status-danger/20 bg-status-danger/5 px-4 py-2.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium truncate">{c.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {c.noCandidateEventCount} events blocked — no candidate changes found.
                      {c.noCandidateEventCount > 0 && " Log missing changes in the changelog."}
                    </p>
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-status-danger flex-shrink-0">
                    Blocked
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recently Confirmed */}
      {attributed.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[13px] font-semibold">Recently Confirmed</h2>
            <Link
              href="/review"
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              All resolved <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-1.5">
            {attributed.slice(0, 4).map((r) => {
              const change = r.primary_change_id
                ? changelogEntries.find((c) => c.id === r.primary_change_id)
                : null;
              return (
                <div
                  key={r.event.id}
                  className="rounded-md border border-status-success/20 bg-status-success/5 px-4 py-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium truncate">
                        {r.event.topic}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {r.status === "attributed" ? "Confirmed" : "Auto-resolved"}: {change?.asset_name ?? "unknown change"} → {r.event.description}
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-status-success flex-shrink-0">
                      {r.status === "attributed" ? "Confirmed" : "Auto"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Changes Awaiting Signal */}
      {recentChanges.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[13px] font-semibold">Recent Changes Awaiting Signal</h2>
            <Link
              href="/changes"
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              Full changelog <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-1">
            {recentChanges.map((entry) => {
              const learning = changeLearning.find(
                (cl) => cl.change_id === entry.id
              );
              const hasEvidence = learning && learning.events_attributed > 0;
              return (
                <Link
                  key={entry.id}
                  href={`/changes/${entry.id}`}
                  className="block rounded-md border border-border px-3 py-2 hover:bg-surface-inset transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium truncate">
                        {entry.asset_name}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {entry.change_description}
                      </p>
                    </div>
                    <span className={`text-[10px] font-medium flex-shrink-0 ${
                      hasEvidence
                        ? "text-status-success"
                        : "text-muted-foreground"
                    }`}>
                      {hasEvidence
                        ? `${learning!.events_attributed} event${learning!.events_attributed !== 1 ? "s" : ""}`
                        : "No signal yet"}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {events.length === 0 && results.length > 0 && (
        <div className="rounded-md border border-border p-8 text-center">
          <p className="text-[14px] font-medium mb-1">No outcome events detected</p>
          <p className="text-[12px] text-muted-foreground">
            {results.length} results imported but no meaningful signals found yet.
            Check that results include mention/citation data with temporal variation.
          </p>
        </div>
      )}

      {results.length === 0 && (
        <div className="rounded-md border border-border p-8 text-center">
          <p className="text-[14px] font-medium mb-1">No data yet</p>
          <Link
            href="/import"
            className="text-[12px] text-accent-primary hover:underline font-medium"
          >
            Import a workbook to begin
          </Link>
        </div>
      )}

      {/* Quick links */}
      <div className="flex items-center gap-4 pt-2 border-t border-border text-[11px] text-muted-foreground flex-wrap">
        <Link href="/review" className="hover:text-foreground">Review</Link>
        <Link href="/changes" className="hover:text-foreground">Changelog</Link>
        <Link href="/actions" className="hover:text-foreground">Actions</Link>
        <Link href="/diagnostics" className="hover:text-foreground">Diagnostics</Link>
        <Link href="/opportunities" className="hover:text-foreground">Opportunities</Link>
        <Link href="/expansion" className="hover:text-foreground">Expansion</Link>
        <Link href="/briefs/proposed" className="hover:text-foreground">Briefs</Link>
        <Link href="/import" className="hover:text-foreground">Import</Link>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="max-w-2xl mx-auto py-16 text-center">
      <h1 className="text-[20px] font-semibold mb-2">Beacon</h1>
      <p className="text-[13px] text-muted-foreground mb-6">
        Attribution review and experiment learning tool.
        Import a workbook to begin.
      </p>
      <Link
        href="/import"
        className="text-[13px] text-accent-primary hover:underline font-medium"
      >
        Go to Import
      </Link>
    </div>
  );
}
