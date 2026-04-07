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
  candidateCount: number;
  attributedCount: number;
};

export default function ReviewPage() {
  const rows: ReviewRow[] = [];
  let totalCandidates = 0;
  let unreviewed = 0;
  let labeled = 0;

  for (const result of results) {
    const candidates = discoverCandidates(result, changelogEntries, opportunities);
    if (candidates.length > 0) {
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
        candidateCount: candidates.length,
        attributedCount: result.attributed_changelog_ids.length,
      });
      totalCandidates += candidates.length;
      unreviewed++;
    }
  }

  const confirmedCount = candidateLinks.filter(
    (cl) => cl.status === "confirmed"
  ).length;
  const rejectedCount = candidateLinks.filter(
    (cl) => cl.status === "rejected"
  ).length;
  labeled = truthLabels.length;

  const sortedRows = rows.sort(
    (a, b) => b.candidateCount - a.candidateCount
  );

  return (
    <div>
      <PageHeader
        title="Attribution Review"
        description="Review candidate attributions. Confirm or reject to build ground truth."
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5 mb-6">
        <StatCard label="Needs Review" value={unreviewed} />
        <StatCard label="Total Candidates" value={totalCandidates} />
        <StatCard label="Confirmed" value={confirmedCount} />
        <StatCard label="Rejected" value={rejectedCount} />
        <StatCard label="Truth Labels" value={labeled} />
      </div>

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
                Linked
              </TableHead>
              <TableHead className="text-[11px] font-medium text-right">
                Candidates
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
                <TableCell className="text-[13px] tabular-nums text-right text-muted-foreground">
                  {row.attributedCount}
                </TableCell>
                <TableCell className="text-[13px] tabular-nums text-right">
                  <span
                    className={
                      row.candidateCount > 0
                        ? "text-status-warning font-medium"
                        : "text-muted-foreground"
                    }
                  >
                    {row.candidateCount}
                  </span>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/results/${row.resultId}`}
                    className="text-[12px] text-accent-primary hover:underline font-medium"
                  >
                    {row.candidateCount > 0 ? "Review" : "View"}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
