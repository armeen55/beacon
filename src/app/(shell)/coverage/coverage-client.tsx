"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { TabFilter } from "@/components/display/tab-filter";
import { ProgressBar } from "@/components/display/progress-bar";
import { CoverageStatusBadge } from "@/components/display/status-badge";
import { PriorityBadge } from "@/components/display/priority-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { COVERAGE_CATEGORY_LABELS } from "@/lib/constants";
import type { CoverageStatus } from "@/lib/constants";
import type { CoverageItem } from "@/domains/coverage/types";

const statusTabs = [
  { label: "All", value: "all" },
  { label: "Missing", value: "missing" },
  { label: "Partial", value: "partial" },
  { label: "Needs Update", value: "needs_update" },
  { label: "Complete", value: "complete" },
];

interface CoverageClientProps {
  coverageItems: CoverageItem[];
}

export function CoverageClient({ coverageItems }: CoverageClientProps) {
  const [activeStatus, setActiveStatus] = useState("all");

  const filtered =
    activeStatus === "all"
      ? coverageItems
      : coverageItems.filter((i) => i.status === activeStatus);

  const totalItems = coverageItems.length;
  const completeCount = coverageItems.filter((i) => i.status === "complete").length;
  const pct = Math.round((completeCount / totalItems) * 100);

  const statusCounts: Record<string, number> = { all: coverageItems.length };
  for (const item of coverageItems) {
    statusCounts[item.status] = (statusCounts[item.status] ?? 0) + 1;
  }

  const progressVariant =
    pct >= 80 ? "success" : pct >= 50 ? "warning" : "danger";

  return (
    <div>
      <PageHeader
        title="Coverage"
        description="Foundational elements for AI and search discoverability."
      />

      <div className="rounded-md border border-border p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[13px] font-medium">
            Overall Coverage
          </p>
          <p className="text-[13px] font-semibold tabular-nums">
            {completeCount}/{totalItems} complete ({pct}%)
          </p>
        </div>
        <ProgressBar value={pct} variant={progressVariant} size="md" />
        <div className="flex gap-4 mt-3">
          {(["missing", "partial", "needs_update", "complete"] as CoverageStatus[]).map((status) => (
            <div key={status} className="flex items-center gap-1.5">
              <CoverageStatusBadge status={status} />
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {statusCounts[status] ?? 0}
              </span>
            </div>
          ))}
        </div>
      </div>

      <TabFilter
        tabs={statusTabs.map((t) => ({ ...t, count: statusCounts[t.value] ?? 0 }))}
        value={activeStatus}
        onChange={setActiveStatus}
        className="mb-4"
      />

      <div className="rounded-md border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface-raised hover:bg-surface-raised">
              <TableHead className="text-[11px] font-medium">Item</TableHead>
              <TableHead className="text-[11px] font-medium">Category</TableHead>
              <TableHead className="text-[11px] font-medium">URL</TableHead>
              <TableHead className="text-[11px] font-medium">Status</TableHead>
              <TableHead className="text-[11px] font-medium">Priority</TableHead>
              <TableHead className="text-[11px] font-medium">Last Checked</TableHead>
              <TableHead className="text-[11px] font-medium">Brief</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="text-[13px] font-medium max-w-xs">
                  {item.item_name}
                  {item.notes && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                      {item.notes}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-[12px] text-muted-foreground">
                  {COVERAGE_CATEGORY_LABELS[item.category]}
                </TableCell>
                <TableCell className="text-[12px] text-muted-foreground font-mono">
                  {item.url ?? "—"}
                </TableCell>
                <TableCell>
                  <CoverageStatusBadge status={item.status} />
                </TableCell>
                <TableCell>
                  <PriorityBadge priority={item.priority} />
                </TableCell>
                <TableCell className="text-[12px] text-muted-foreground whitespace-nowrap">
                  {item.last_checked
                    ? new Date(item.last_checked).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    : "Never"}
                </TableCell>
                <TableCell className="text-[12px]">
                  {item.linked_brief_id ? (
                    <Link
                      href={`/briefs/${item.linked_brief_id}`}
                      className="text-accent-primary hover:underline"
                    >
                      View brief
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
