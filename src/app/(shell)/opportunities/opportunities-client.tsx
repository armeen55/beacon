"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { TabFilter } from "@/components/display/tab-filter";
import { PriorityBadge } from "@/components/display/priority-badge";
import { FreshnessDot } from "@/components/display/freshness-dot";
import { formatPlatforms } from "@/domains/opportunities/utils";
import { computeOpportunityScore } from "@/domains/opportunities/scoring";
import { getFreshnessStatus } from "@/domains/opportunities/freshness";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Brief } from "@/domains/briefs/types";
import type { Competitor } from "@/domains/competitors/types";
import type { CompetitorSnapshot } from "@/domains/competitors/types";

type DerivedState = "active_review" | "needs_build" | "monitoring" | "proven" | "blocked" | "new";

const DERIVED_STATE_LABELS: Record<DerivedState, string> = {
  active_review: "Active Review",
  needs_build: "Needs Build",
  monitoring: "Monitoring",
  proven: "Proven Win",
  blocked: "Blocked",
  new: "New",
};

const DERIVED_STATE_COLORS: Record<DerivedState, string> = {
  active_review: "text-status-warning",
  needs_build: "text-accent-primary",
  monitoring: "text-muted-foreground",
  proven: "text-status-success",
  blocked: "text-status-danger",
  new: "text-foreground",
};

function deriveLiveState(
  opp: Opportunity,
  linkedBriefs: Brief[],
  candidateLinkCount: number,
  confirmedLinkCount: number
): DerivedState {
  if (confirmedLinkCount > 0 && opp.current_status === "captured") return "proven";
  if (confirmedLinkCount > 0) return "monitoring";
  if (candidateLinkCount > 0) return "active_review";
  if (linkedBriefs.length > 0 || opp.current_status === "executing") return "needs_build";
  if (opp.current_status === "monitoring") return "monitoring";
  return "new";
}

const statusTabs: { label: string; value: string }[] = [
  { label: "All", value: "all" },
  { label: "Active Review", value: "active_review" },
  { label: "Needs Build", value: "needs_build" },
  { label: "Monitoring", value: "monitoring" },
  { label: "Proven", value: "proven" },
  { label: "New", value: "new" },
];

interface OpportunitiesClientProps {
  opportunities: Opportunity[];
  briefs: Brief[];
  competitors: Competitor[];
  competitorSnapshots: CompetitorSnapshot[];
  candidateLinkCounts: Record<string, number>;
  confirmedLinkCounts: Record<string, number>;
}

export function OpportunitiesClient({
  opportunities,
  briefs,
  competitors,
  competitorSnapshots,
  candidateLinkCounts,
  confirmedLinkCounts,
}: OpportunitiesClientProps) {
  const [activeTab, setActiveTab] = useState("all");

  function getLinkedBriefs(opp: Opportunity) {
    return briefs.filter(
      (b) =>
        opp.linked_brief_ids.includes(b.id) ||
        b.opportunity_ids.includes(opp.id)
    );
  }

  const rows = opportunities.map((opp) => {
    const linked = getLinkedBriefs(opp);
    const score = computeOpportunityScore(opp, linked, competitorSnapshots);
    const freshness = getFreshnessStatus(opp);
    const liveState = deriveLiveState(
      opp,
      linked,
      candidateLinkCounts[opp.id] ?? 0,
      confirmedLinkCounts[opp.id] ?? 0
    );
    return { opp, score, freshness, liveState, linked };
  });

  const counts: Record<string, number> = { all: opportunities.length };
  for (const row of rows) {
    counts[row.liveState] = (counts[row.liveState] ?? 0) + 1;
  }

  const filtered =
    activeTab === "all"
      ? rows
      : rows.filter((r) => r.liveState === activeTab);

  const sorted = filtered.sort((a, b) => b.score.total - a.score.total);

  return (
    <div>
      <PageHeader
        title="Opportunities"
        description={`${opportunities.length} opportunities. States derived from review and attribution evidence — not manually set.`}
      />

      <TabFilter
        tabs={statusTabs.map((t) => ({ ...t, count: counts[t.value] ?? 0 }))}
        value={activeTab}
        onChange={setActiveTab}
        className="mb-4"
      />

      <div className="space-y-1.5">
        {sorted.map(({ opp, score, freshness, liveState, linked }) => (
          <Link
            key={opp.id}
            href={`/opportunities/${opp.id}`}
            className="block rounded-md border border-border px-4 py-3 hover:bg-surface-inset transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-medium truncate">{opp.title}</p>
                  <PriorityBadge priority={opp.priority} />
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                  {opp.city && <span>{opp.city}</span>}
                  <span>{formatPlatforms(opp.platforms)}</span>
                  <FreshnessDot
                    level={freshness.level}
                    daysSinceActivity={freshness.daysSinceActivity}
                  />
                  {opp.primary_competitor_id && (
                    <span>
                      vs {competitors.find((c) => c.id === opp.primary_competitor_id)?.name ?? "—"}
                    </span>
                  )}
                </div>
                {linked.length > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {linked.length} brief{linked.length !== 1 ? "s" : ""} linked
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="text-right">
                  <p className="text-[12px] font-medium tabular-nums">{score.total}</p>
                  <p className="text-[9px] text-muted-foreground uppercase">{score.label}</p>
                </div>
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${DERIVED_STATE_COLORS[liveState]}`}>
                  {DERIVED_STATE_LABELS[liveState]}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {sorted.length === 0 && (
        <div className="rounded-md border border-border p-8 text-center">
          <p className="text-[14px] font-medium">No opportunities match this filter</p>
        </div>
      )}
    </div>
  );
}
