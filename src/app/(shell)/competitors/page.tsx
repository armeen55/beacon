import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { ThreatBadge } from "@/components/display/threat-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { competitors, competitorSnapshots, opportunities } from "@/lib/seed-data.server";
import { PLATFORM_LABELS } from "@/lib/constants";
import type { ThreatLevel } from "@/lib/constants";

function deriveThreatLevel(rank: number | null): ThreatLevel {
  if (rank == null) return "low";
  if (rank <= 1) return "critical";
  if (rank <= 3) return "high";
  if (rank <= 5) return "medium";
  return "low";
}

export default function CompetitorsPage() {
  return (
    <div>
      <PageHeader
        title="Competitors"
        description="Tracked competitors with latest visibility snapshots."
      />

      <div className="rounded-md border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface-raised hover:bg-surface-raised">
              <TableHead className="text-[11px] font-medium">Competitor</TableHead>
              <TableHead className="text-[11px] font-medium">Domain</TableHead>
              <TableHead className="text-[11px] font-medium">Threat</TableHead>
              <TableHead className="text-[11px] font-medium">Platform</TableHead>
              <TableHead className="text-[11px] font-medium text-right">Rank</TableHead>
              <TableHead className="text-[11px] font-medium text-right">Citation %</TableHead>
              <TableHead className="text-[11px] font-medium text-right">SoV %</TableHead>
              <TableHead className="text-[11px] font-medium text-right">Contested</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {competitors.map((comp) => {
              const snapshots = competitorSnapshots
                .filter((s) => s.competitor_id === comp.id)
                .sort(
                  (a, b) =>
                    new Date(b.snapshot_date).getTime() -
                    new Date(a.snapshot_date).getTime()
                );
              const latest = snapshots[0] ?? null;
              const bestRank = snapshots.reduce<number | null>((best, s) => {
                if (s.visibility_rank == null) return best;
                if (best == null) return s.visibility_rank;
                return Math.min(best, s.visibility_rank);
              }, null);
              const threatLevel = deriveThreatLevel(bestRank);
              const contestedCount = opportunities.filter((o) =>
                o.competitor_ids.includes(comp.id)
              ).length;

              return (
                <TableRow key={comp.id}>
                  <TableCell className="text-[13px] font-medium">
                    <Link
                      href={`/competitors/${comp.id}`}
                      className="hover:text-accent-primary transition-colors"
                    >
                      {comp.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-[12px] text-muted-foreground font-mono">
                    {comp.domain}
                  </TableCell>
                  <TableCell>
                    <ThreatBadge level={threatLevel} />
                  </TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">
                    {latest ? PLATFORM_LABELS[latest.platform] : "—"}
                  </TableCell>
                  <TableCell className="text-[13px] text-right tabular-nums font-semibold">
                    {bestRank ?? "—"}
                  </TableCell>
                  <TableCell className="text-[12px] text-right tabular-nums">
                    {latest?.citation_share
                      ? `${latest.citation_share}%`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-[12px] text-right tabular-nums">
                    {latest?.share_of_voice
                      ? `${latest.share_of_voice}%`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-[13px] text-right tabular-nums font-medium">
                    {contestedCount > 0 ? contestedCount : "—"}
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
