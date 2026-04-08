"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { StatCard } from "@/components/data/stat-card";
import { TabFilter } from "@/components/display/tab-filter";
import { DeltaIndicator } from "@/components/display/delta-indicator";
import { ConfidenceBadge } from "@/components/display/confidence-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PLATFORM_LABELS, METRIC_TYPE_LABELS, METRIC_DIRECTION } from "@/lib/constants";
import { computeAttribution } from "@/domains/attribution/compute";
import type { Platform } from "@/lib/constants";
import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";

const platformTabs = [
  { label: "All Platforms", value: "all" },
  { label: "ChatGPT", value: "chatgpt" },
  { label: "Google AIO", value: "google_aio" },
  { label: "Perplexity", value: "perplexity" },
];

interface ResultsClientProps {
  results: Result[];
  changelogEntries: ChangelogEntry[];
  opportunities: Opportunity[];
}

export function ResultsClient({ results, changelogEntries, opportunities }: ResultsClientProps) {
  const [activePlatform, setActivePlatform] = useState("all");

  const filtered =
    activePlatform === "all"
      ? results
      : results.filter((r) => r.platform === activePlatform);

  const sorted = [...filtered].sort(
    (a, b) =>
      new Date(b.snapshot_date).getTime() - new Date(a.snapshot_date).getTime()
  );

  const platformCounts: Record<string, number> = { all: results.length };
  for (const r of results) {
    platformCounts[r.platform] = (platformCounts[r.platform] ?? 0) + 1;
  }

  const attributed = results.filter((r) => r.attributed_changelog_ids.length > 0).length;
  const positive = results.filter((r) => {
    if (r.delta == null) return false;
    const dir = METRIC_DIRECTION[r.metric_type];
    return dir === "lower_is_better" ? r.delta < 0 : r.delta > 0;
  }).length;
  const negative = results.filter((r) => {
    if (r.delta == null) return false;
    const dir = METRIC_DIRECTION[r.metric_type];
    return dir === "lower_is_better" ? r.delta > 0 : r.delta < 0;
  }).length;

  return (
    <div>
      <PageHeader
        title="Results"
        description="Point-in-time readouts of how you're showing up, and what we think drove each move."
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard label="Snapshots" value={results.length} />
        <StatCard label="Linked to a ship" value={attributed} />
        <StatCard label="Moved the right way" value={positive} />
        <StatCard label="Moved the wrong way" value={negative} />
      </div>

      <TabFilter
        tabs={platformTabs.map((t) => ({ ...t, count: platformCounts[t.value] ?? 0 }))}
        value={activePlatform}
        onChange={setActivePlatform}
        className="mb-4"
      />

      <div className="rounded-md border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface-raised hover:bg-surface-raised">
              <TableHead className="text-[11px] font-medium">Date</TableHead>
              <TableHead className="text-[11px] font-medium">Metric</TableHead>
              <TableHead className="text-[11px] font-medium text-right">Value</TableHead>
              <TableHead className="text-[11px] font-medium text-right">Change</TableHead>
              <TableHead className="text-[11px] font-medium">Topic</TableHead>
              <TableHead className="text-[11px] font-medium">Likely driver</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => {
              const isInverted =
                r.metric_type === "visibility_rank" || r.metric_type === "average_position";
              const linkedChanges = changelogEntries.filter((c) =>
                r.attributed_changelog_ids.includes(c.id)
              );
              const primaryChange = linkedChanges[0] ?? null;
              const attribution = primaryChange
                ? computeAttribution(primaryChange, r, opportunities)
                : null;

              return (
                <TableRow key={r.id}>
                  <TableCell className="text-[12px] text-muted-foreground whitespace-nowrap">
                    <Link
                      href={`/results/${r.id}`}
                      className="hover:text-accent-primary transition-colors"
                    >
                      {new Date(r.snapshot_date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </Link>
                    <span className="block text-[11px]">
                      {PLATFORM_LABELS[r.platform]}
                    </span>
                  </TableCell>
                  <TableCell className="text-[13px] font-medium">
                    <Link
                      href={`/results/${r.id}`}
                      className="hover:text-accent-primary transition-colors"
                    >
                      {METRIC_TYPE_LABELS[r.metric_type]}
                    </Link>
                  </TableCell>
                  <TableCell className="text-[13px] text-right tabular-nums font-semibold">
                    {r.metric_value}
                  </TableCell>
                  <TableCell className="text-right">
                    <DeltaIndicator
                      value={r.delta_percentage}
                      invertColor={isInverted}
                    />
                  </TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">
                    {r.topic ?? "—"}
                  </TableCell>
                  <TableCell className="text-[12px] max-w-[200px]">
                    {primaryChange && attribution ? (
                      <div className="space-y-0.5">
                        <Link
                          href={`/changes/${primaryChange.id}`}
                          className="text-accent-primary hover:underline text-[12px] line-clamp-1"
                        >
                          {primaryChange.asset_name}
                        </Link>
                        <ConfidenceBadge confidence={attribution.confidence} />
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
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
