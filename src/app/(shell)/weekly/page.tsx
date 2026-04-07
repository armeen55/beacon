import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { StatusDot } from "@/components/display/status-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { weeklySummaries, hasActiveExperiment } from "@/lib/seed-data.server";

export default function WeeklyPage() {
  if (hasActiveExperiment() && weeklySummaries.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <h2 className="text-[16px] font-semibold mb-2">
          Weekly summaries are not generated for the active experiment
        </h2>
        <p className="text-[13px] text-muted-foreground mb-4">
          The Ritz workbook import does not produce weekly rollups.
          Use the Dashboard and Diagnostics surfaces for experiment analysis.
        </p>
        <div className="flex justify-center gap-4">
          <Link
            href="/"
            className="text-[12px] text-accent-primary hover:underline font-medium"
          >
            Dashboard
          </Link>
          <Link
            href="/diagnostics"
            className="text-[12px] text-accent-primary hover:underline font-medium"
          >
            Diagnostics
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Weekly Summaries"
        description="Week-by-week rollup of changes, results, and recommendations."
      />

      <div className="rounded-md border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface-raised hover:bg-surface-raised">
              <TableHead className="text-[11px] font-medium">Week</TableHead>
              <TableHead className="text-[11px] font-medium">Status</TableHead>
              <TableHead className="text-[11px] font-medium text-right">Changes</TableHead>
              <TableHead className="text-[11px] font-medium">Highlights</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {weeklySummaries.map((week) => (
              <TableRow key={week.id}>
                <TableCell className="text-[13px] font-medium whitespace-nowrap">
                  <Link
                    href={`/weekly/${week.id}`}
                    className="hover:text-accent-primary transition-colors"
                  >
                    {week.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusDot
                    status={week.status === "published" ? "success" : "neutral"}
                    label={week.status === "published" ? "Published" : "Draft"}
                  />
                </TableCell>
                <TableCell className="text-[13px] text-right tabular-nums font-semibold">
                  {week.changes_count}
                </TableCell>
                <TableCell className="text-[12px] text-muted-foreground max-w-md">
                  <p className="line-clamp-2">{week.highlights}</p>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
