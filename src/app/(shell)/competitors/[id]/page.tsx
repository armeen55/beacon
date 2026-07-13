import { notFound } from "next/navigation";
import { StatusDot } from "@/components/display/status-dot";
import { ThreatBadge } from "@/components/display/threat-badge";
import { EntityLinkCard } from "@/components/data/entity-link-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getCompetitors,
  getCompetitorSnapshots,
} from "@/lib/seed-data.server";
import { getOpportunitiesForCompetitor } from "@/lib/lookups";
import { PLATFORM_LABELS, OPPORTUNITY_STATUS_LABELS } from "@/lib/constants";
import type { ThreatLevel } from "@/lib/constants";

function deriveThreatLevel(rank: number | null): ThreatLevel {
  if (rank == null) return "low";
  if (rank <= 1) return "critical";
  if (rank <= 3) return "high";
  if (rank <= 5) return "medium";
  return "low";
}

export default async function CompetitorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [competitors, competitorSnapshots] = await Promise.all([
    getCompetitors(),
    getCompetitorSnapshots(),
  ]);
  const competitor = competitors.find((c) => c.id === id);
  if (!competitor) notFound();

  const snapshots = competitorSnapshots
    .filter((s) => s.competitor_id === competitor.id)
    .sort(
      (a, b) =>
        new Date(b.snapshot_date).getTime() -
        new Date(a.snapshot_date).getTime()
    );
  const allTopics = [...new Set(snapshots.flatMap((s) => s.topics_present))];
  const contestedOpportunities = await getOpportunitiesForCompetitor(competitor.id);

  const bestRank = snapshots.reduce<number | null>((best, s) => {
    if (s.visibility_rank == null) return best;
    if (best == null) return s.visibility_rank;
    return Math.min(best, s.visibility_rank);
  }, null);
  const overallThreat = deriveThreatLevel(bestRank);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">
            {competitor.name}
          </h2>
          <ThreatBadge level={overallThreat} />
        </div>
        <div className="flex items-center gap-3 mt-2">
          <span className="text-[12px] text-muted-foreground font-mono">
            {competitor.domain}
          </span>
          <StatusDot
            status={competitor.is_active ? "success" : "neutral"}
            label={competitor.is_active ? "Active" : "Inactive"}
          />
        </div>
      </div>

      {competitor.description && (
        <p className="text-[13px] text-foreground-secondary leading-relaxed">
          {competitor.description}
        </p>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-md border border-border p-3">
          <p className="text-[11px] font-medium text-muted-foreground mb-0.5">
            Best Rank
          </p>
          <p className="text-lg font-semibold tabular-nums">
            {bestRank ?? "—"}
          </p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-[11px] font-medium text-muted-foreground mb-0.5">
            Contested Opportunities
          </p>
          <p className="text-lg font-semibold tabular-nums">
            {contestedOpportunities.length}
          </p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-[11px] font-medium text-muted-foreground mb-0.5">
            Topics Present
          </p>
          <p className="text-lg font-semibold tabular-nums">
            {allTopics.length}
          </p>
        </div>
      </div>

      {snapshots.length > 0 && (
        <div className="border-t border-border pt-5">
          <h3 className="text-[13px] font-semibold mb-3">
            Visibility Snapshots
          </h3>
          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-surface-raised hover:bg-surface-raised">
                  <TableHead className="text-[11px] font-medium">Date</TableHead>
                  <TableHead className="text-[11px] font-medium">Platform</TableHead>
                  <TableHead className="text-[11px] font-medium">Threat</TableHead>
                  <TableHead className="text-[11px] font-medium text-right">Rank</TableHead>
                  <TableHead className="text-[11px] font-medium text-right">AI picks %</TableHead>
                  <TableHead className="text-[11px] font-medium text-right">Times named</TableHead>
                  <TableHead className="text-[11px] font-medium text-right">Share of answers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.map((snap) => {
                  const snapThreat = deriveThreatLevel(snap.visibility_rank);
                  return (
                    <TableRow key={snap.id}>
                      <TableCell className="text-[12px] text-muted-foreground whitespace-nowrap">
                        {new Date(snap.snapshot_date).toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric" }
                        )}
                      </TableCell>
                      <TableCell className="text-[12px]">
                        {PLATFORM_LABELS[snap.platform]}
                      </TableCell>
                      <TableCell>
                        <ThreatBadge level={snapThreat} />
                      </TableCell>
                      <TableCell className="text-[13px] text-right tabular-nums font-semibold">
                        {snap.visibility_rank ?? "—"}
                      </TableCell>
                      <TableCell className="text-[12px] text-right tabular-nums">
                        {snap.citation_share ? `${snap.citation_share}%` : "—"}
                      </TableCell>
                      <TableCell className="text-[12px] text-right tabular-nums">
                        {snap.mention_count ?? "—"}
                      </TableCell>
                      <TableCell className="text-[12px] text-right tabular-nums">
                        {snap.share_of_voice
                          ? `${snap.share_of_voice}%`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {allTopics.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold mb-2">Topics Present</h3>
          <div className="flex flex-wrap gap-2">
            {allTopics.map((topic) => (
              <span
                key={topic}
                className="text-[12px] px-2 py-0.5 rounded-md bg-surface-inset text-foreground-secondary"
              >
                {topic}
              </span>
            ))}
          </div>
        </div>
      )}

      {contestedOpportunities.length > 0 && (
        <div className="border-t border-border pt-5 space-y-5">
          <h3 className="text-[13px] font-semibold">Contested Opportunities</h3>
          <div className="space-y-2">
            {contestedOpportunities.map((opp) => (
              <EntityLinkCard
                key={opp.id}
                type="opportunity"
                href={`/topics/opportunity/${opp.id}`}
                title={opp.title}
                subtitle={opp.description ?? undefined}
                meta={OPPORTUNITY_STATUS_LABELS[opp.current_status]}
              />
            ))}
          </div>
        </div>
      )}

      {competitor.notes && (
        <div className="border-t border-border pt-5">
          <h3 className="text-[13px] font-semibold mb-2">Notes</h3>
          <p className="text-[13px] text-foreground-secondary leading-relaxed bg-surface-inset rounded-md p-3">
            {competitor.notes}
          </p>
        </div>
      )}
    </div>
  );
}
