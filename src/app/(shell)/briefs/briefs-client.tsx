"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { TabFilter } from "@/components/display/tab-filter";
import { BriefStatusBadge } from "@/components/display/status-badge";
import { PriorityBadge } from "@/components/display/priority-badge";
import { EffortBadge } from "@/components/display/effort-badge";
import { ProgressBar } from "@/components/display/progress-bar";
import { StallDot } from "@/components/display/stall-dot";
import { BriefVerdictBadge } from "@/components/display/brief-verdict-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BRIEF_TYPE_LABELS } from "@/lib/constants";
import type { BriefStatus } from "@/lib/constants";
import { getBriefProgress } from "@/domains/briefs/utils";
import { getStallStatus } from "@/domains/briefs/stall";
import { computeBriefVerdict } from "@/domains/attribution/compute";
import type { Brief } from "@/domains/briefs/types";

const statusTabs = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Approved", value: "approved" },
  { label: "In Progress", value: "in_progress" },
  { label: "Completed", value: "completed" },
  { label: "Blocked", value: "blocked" },
];

interface BriefsClientProps {
  briefs: Brief[];
}

export function BriefsClient({ briefs }: BriefsClientProps) {
  const [activeTab, setActiveTab] = useState("all");

  const statusCounts: Record<string, number> = { all: briefs.length };
  for (const b of briefs) {
    statusCounts[b.status] = (statusCounts[b.status] ?? 0) + 1;
  }

  const filtered =
    activeTab === "all"
      ? briefs
      : briefs.filter((b) => b.status === (activeTab as BriefStatus));

  return (
    <div>
      <PageHeader
        title="Briefs"
        description="Execution plans connecting opportunities to changes."
      />

      <TabFilter
        tabs={statusTabs.map((t) => ({
          ...t,
          count: statusCounts[t.value] ?? 0,
        }))}
        value={activeTab}
        onChange={setActiveTab}
        className="mb-4"
      />

      <div className="rounded-md border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface-raised hover:bg-surface-raised">
              <TableHead className="text-[11px] font-medium w-6" />
              <TableHead className="text-[11px] font-medium">Title</TableHead>
              <TableHead className="text-[11px] font-medium">Type</TableHead>
              <TableHead className="text-[11px] font-medium">Status</TableHead>
              <TableHead className="text-[11px] font-medium">
                Priority
              </TableHead>
              <TableHead className="text-[11px] font-medium">
                Progress
              </TableHead>
              <TableHead className="text-[11px] font-medium">
                Verdict
              </TableHead>
              <TableHead className="text-[11px] font-medium">Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((brief) => {
              const progress = getBriefProgress(brief.checklist);
              const stall = getStallStatus(brief);
              const verdict = computeBriefVerdict(brief);

              return (
                <TableRow key={brief.id}>
                  <TableCell className="w-6 pr-0">
                    <StallDot level={stall.level} />
                  </TableCell>
                  <TableCell className="text-[13px] font-medium max-w-sm">
                    <Link
                      href={`/briefs/${brief.id}`}
                      className="hover:text-accent-primary transition-colors"
                    >
                      {brief.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">
                    {BRIEF_TYPE_LABELS[brief.brief_type]}
                  </TableCell>
                  <TableCell>
                    <BriefStatusBadge status={brief.status} />
                  </TableCell>
                  <TableCell>
                    <PriorityBadge priority={brief.priority} />
                  </TableCell>
                  <TableCell className="min-w-[100px]">
                    {progress.total > 0 ? (
                      <div className="flex items-center gap-2">
                        <ProgressBar
                          value={progress.percentage}
                          className="flex-1"
                          variant={
                            progress.percentage === 100 ? "success" : "default"
                          }
                        />
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                          {progress.percentage}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        —
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {brief.expected_outcomes.length > 0 ? (
                      <BriefVerdictBadge verdict={verdict.verdict} />
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[12px] text-muted-foreground whitespace-nowrap">
                    {brief.due_date
                      ? new Date(brief.due_date).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
