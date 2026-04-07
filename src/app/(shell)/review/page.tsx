import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { StatCard } from "@/components/data/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { results, changelogEntries, opportunities } from "@/lib/seed-data.server";
import { discoverCandidates } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import { classifyResultMode } from "@/domains/attribution/result-mode";
import { candidateLinks, truthLabels } from "@/domains/attribution/store";
import { PLATFORM_LABELS, METRIC_TYPE_LABELS } from "@/lib/constants";
import { DeltaIndicator } from "@/components/display/delta-indicator";

type ReviewRow = {
  resultId: string;
  metricType: string;
  platform: string;
  topic: string | null;
  date: string;
  delta: number | null;
  isInverted: boolean;
  reviewCount: number;
  totalCandidates: number;
  hasPrimary: boolean;
};

export default function ReviewPage() {
  const rows: ReviewRow[] = [];
  let autoResolved = 0;
  let needsReviewCount = 0;
  let totalAllCandidates = 0;
  let visibilityCount = 0;

  for (const result of results) {
    const mode = classifyResultMode(result);
    if (mode === "visibility") {
      visibilityCount++;
      continue;
    }

    const candidates = discoverCandidates(result, changelogEntries, opportunities);
    if (candidates.length === 0) continue;

    const triage = triageCandidates(candidates);
    totalAllCandidates += candidates.length;

    if (triage.autoResolved) {
      autoResolved++;
      continue;
    }

    if (triage.needsReview.length > 0) {
      needsReviewCount++;
      rows.push({
        resultId: result.id,
        metricType: METRIC_TYPE_LABELS[result.metric_type],
        platform: PLATFORM_LABELS[result.platform],
        topic: result.topic,
        date: result.snapshot_date,
        delta: result.delta_percentage,
        isInverted:
          result.metric_type === "visibility_rank" ||
          result.metric_type === "average_position",
        reviewCount: triage.needsReview.length,
        totalCandidates: candidates.length,
        hasPrimary: triage.primary !== null,
      });
    }
  }

  const confirmedCount = candidateLinks.filter(
    (cl) => cl.status === "confirmed"
  ).length;
  const rejectedCount = candidateLinks.filter(
    (cl) => cl.status === "rejected"
  ).length;
  const labeled = truthLabels.length;

  const sortedRows = rows.sort(
    (a, b) => b.reviewCount - a.reviewCount || b.totalCandidates - a.totalCandidates
  );

  return (
    <div>
      <PageHeader
        title="Attribution Review"
        description="Attribution-mode results with ambiguous candidates. Visibility-only results are excluded."
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6 mb-6">
        <StatCard label="Needs Review" value={needsReviewCount} />
        <StatCard label="Auto-Resolved" value={autoResolved} />
        <StatCard label="Visibility Only" value={visibilityCount} />
        <StatCard label="Confirmed" value={confirmedCount} />
        <StatCard label="Rejected" value={rejectedCount} />
        <StatCard label="Truth Labels" value={labeled} />
      </div>

      {sortedRows.length === 0 ? (
        <div className="rounded-md border border-border p-8 text-center">
          <p className="text-[14px] font-medium">No results need review</p>
          <p className="text-[12px] text-muted-foreground mt-1">
            {autoResolved > 0
              ? `${autoResolved} result${autoResolved !== 1 ? "s" : ""} auto-resolved. ${totalAllCandidates} total candidates triaged.`
              : "Import data and run candidate discovery to populate the review queue."}
          </p>
          <Link
            href="/diagnostics"
            className="inline-block mt-3 text-[12px] text-accent-primary hover:underline font-medium"
          >
            View Diagnostics
          </Link>
        </div>
      ) : (
        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-surface-raised hover:bg-surface-raised">
                <TableHead className="text-[11px] font-medium">Date</TableHead>
                <TableHead className="text-[11px] font-medium">Metric</TableHead>
                <TableHead className="text-[11px] font-medium">Topic</TableHead>
                <TableHead className="text-[11px] font-medium text-right">
                  Change
                </TableHead>
                <TableHead className="text-[11px] font-medium text-right">
                  Review
                </TableHead>
                <TableHead className="text-[11px] font-medium text-center">
                  Primary
                </TableHead>
                <TableHead className="text-[11px] font-medium">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((row) => (
                <TableRow key={row.resultId}>
                  <TableCell className="text-[12px] text-muted-foreground whitespace-nowrap">
                    {new Date(row.date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                    <span className="block text-[11px]">{row.platform}</span>
                  </TableCell>
                  <TableCell className="text-[13px] font-medium">
                    {row.metricType}
                  </TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">
                    {row.topic ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <DeltaIndicator
                      value={row.delta}
                      invertColor={row.isInverted}
                    />
                  </TableCell>
                  <TableCell className="text-[13px] tabular-nums text-right">
                    <span className="text-status-warning font-medium">
                      {row.reviewCount}
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      /{row.totalCandidates}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    {row.hasPrimary ? (
                      <span className="text-[10px] font-medium text-status-success">
                        Yes
                      </span>
                    ) : (
                      <span className="text-[10px] text-status-warning font-medium">
                        No
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/results/${row.resultId}`}
                      className="text-[12px] text-accent-primary hover:underline font-medium"
                    >
                      Review
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
