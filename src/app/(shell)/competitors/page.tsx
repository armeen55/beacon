import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import {
  competitors,
  competitorSnapshots,
  opportunities,
  hasActiveExperiment,
} from "@/lib/seed-data.server";

export default function CompetitorsPage() {
  const hasSnapshots = competitorSnapshots.length > 0;

  return (
    <div>
      <PageHeader
        title="Competitors"
        description={
          hasSnapshots
            ? "Tracked competitors with latest visibility snapshots."
            : "Imported competitor domains. Visibility snapshots are not yet available — competitor intelligence is not decision-grade for this experiment."
        }
      />

      {!hasSnapshots && hasActiveExperiment() && (
        <div className="rounded-md border border-status-warning/20 bg-status-warning/5 px-4 py-3 mb-4">
          <p className="text-[12px] text-status-warning font-medium mb-0.5">
            Secondary analysis — limited data
          </p>
          <p className="text-[11px] text-muted-foreground">
            Competitor domains were imported but no visibility snapshots exist.
            Threat levels, citation share, and share-of-voice cannot be computed without snapshot data.
            Use Review and Diagnostics for attribution-grade decisions.
          </p>
        </div>
      )}

      {competitors.length === 0 ? (
        <div className="rounded-md border border-border p-8 text-center">
          <p className="text-[14px] font-medium">No competitors imported</p>
          <Link href="/import" className="text-[12px] text-accent-primary hover:underline mt-1 inline-block">
            Import data
          </Link>
        </div>
      ) : (
        <div className="space-y-1.5">
          {competitors.map((comp) => {
            const contestedCount = opportunities.filter((o) =>
              o.competitor_ids.includes(comp.id)
            ).length;

            return (
              <div
                key={comp.id}
                className="rounded-md border border-border px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">{comp.name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                      {comp.domain}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-shrink-0">
                    {contestedCount > 0 && (
                      <span>{contestedCount} contested opportunit{contestedCount !== 1 ? "ies" : "y"}</span>
                    )}
                    {!hasSnapshots && (
                      <span className="text-[10px] text-status-warning">No snapshots</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
