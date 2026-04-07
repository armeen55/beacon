"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { TabFilter } from "@/components/display/tab-filter";
import { OpportunityStatusBadge } from "@/components/display/status-badge";
import { PriorityBadge } from "@/components/display/priority-badge";
import { ScoreRing } from "@/components/display/score-ring";
import { FreshnessDot } from "@/components/display/freshness-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPlatforms } from "@/domains/opportunities/utils";
import { computeOpportunityScore } from "@/domains/opportunities/scoring";
import { getFreshnessStatus } from "@/domains/opportunities/freshness";
import type { OpportunityStatus } from "@/lib/constants";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Brief } from "@/domains/briefs/types";
import type { Competitor } from "@/domains/competitors/types";
import type { CompetitorSnapshot } from "@/domains/competitors/types";

const statusTabs: { label: string; value: string }[] = [
  { label: "All", value: "all" },
  { label: "New", value: "new" },
  { label: "Queued", value: "queued" },
  { label: "Executing", value: "executing" },
  { label: "Validating", value: "validating" },
  { label: "Captured", value: "captured" },
  { label: "Monitoring", value: "monitoring" },
];

interface OpportunitiesClientProps {
  opportunities: Opportunity[];
  briefs: Brief[];
  competitors: Competitor[];
  competitorSnapshots: CompetitorSnapshot[];
}

export function OpportunitiesClient({
  opportunities,
  briefs,
  competitors,
  competitorSnapshots,
}: OpportunitiesClientProps) {
  const [activeTab, setActiveTab] = useState("all");

  const counts: Record<string, number> = { all: opportunities.length };
  for (const opp of opportunities) {
    counts[opp.current_status] = (counts[opp.current_status] ?? 0) + 1;
  }

  function getLinkedBriefs(opp: Opportunity) {
    return briefs.filter(
      (b) =>
        opp.linked_brief_ids.includes(b.id) ||
        b.opportunity_ids.includes(opp.id)
    );
  }

  const filtered =
    activeTab === "all"
      ? opportunities
      : opportunities.filter(
          (o) => o.current_status === (activeTab as OpportunityStatus)
        );

  const scored = filtered
    .map((opp) => {
      const linked = getLinkedBriefs(opp);
      const score = computeOpportunityScore(opp, linked, competitorSnapshots);
      const freshness = getFreshnessStatus(opp);
      return { opp, score, freshness };
    })
    .sort((a, b) => b.score.total - a.score.total);

  return (
    <div>
      <PageHeader
        title="Opportunities"
        description="Queries, topics, and gaps where visibility can be improved."
      />

      <TabFilter
        tabs={statusTabs.map((t) => ({ ...t, count: counts[t.value] ?? 0 }))}
        value={activeTab}
        onChange={setActiveTab}
        className="mb-4"
      />

      <div className="rounded-md border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface-raised hover:bg-surface-raised">
              <TableHead className="text-[11px] font-medium w-[44px]">Score</TableHead>
              <TableHead className="text-[11px] font-medium">Opportunity</TableHead>
              <TableHead className="text-[11px] font-medium">Platform</TableHead>
              <TableHead className="text-[11px] font-medium">Status</TableHead>
              <TableHead className="text-[11px] font-medium">Priority</TableHead>
              <TableHead className="text-[11px] font-medium">Competitor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scored.map(({ opp, score, freshness }) => (
              <TableRow key={opp.id} className="group">
                <TableCell>
                  <ScoreRing
                    score={score.total}
                    label={score.label}
                    size="sm"
                  />
                </TableCell>
                <TableCell className="text-[13px] font-medium max-w-sm">
                  <Link
                    href={`/opportunities/${opp.id}`}
                    className="hover:text-accent-primary transition-colors"
                  >
                    {opp.title}
                  </Link>
                  <div className="flex items-center gap-2 mt-0.5">
                    {opp.city && (
                      <span className="text-[11px] text-muted-foreground">
                        {opp.city}
                      </span>
                    )}
                    <FreshnessDot
                      level={freshness.level}
                      daysSinceActivity={freshness.daysSinceActivity}
                    />
                  </div>
                </TableCell>
                <TableCell className="text-[12px] text-muted-foreground">
                  {formatPlatforms(opp.platforms)}
                </TableCell>
                <TableCell>
                  <OpportunityStatusBadge status={opp.current_status} />
                </TableCell>
                <TableCell>
                  <PriorityBadge priority={opp.priority} />
                </TableCell>
                <TableCell className="text-[12px] text-muted-foreground">
                  {opp.primary_competitor_id
                    ? (competitors.find((c) => c.id === opp.primary_competitor_id)?.name ?? "—")
                    : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
