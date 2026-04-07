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
import { weeklySummaries } from "@/lib/seed-data.server";

export default function WeeklyPage() {
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
