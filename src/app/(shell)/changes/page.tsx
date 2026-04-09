import { PageHeader } from "@/components/data/page-header";
import {
  changelogEntries,
  opportunities,
  results,
} from "@/lib/seed-data.server";
import { eventDecisions } from "@/domains/attribution/store";
import { computeScorecard } from "@/domains/attribution/scorecard";
import { enrichWithImpact } from "@/domains/attribution/change-impact";
import { ScorecardTable } from "./scorecard-client";
import { changeContracts } from "@/domains/changelog/change-contract";
import { ChangeContractUI } from "./change-contract-client";
import { createChangeContract, verifyChangeContract } from "./contract-actions";

export default async function ChangeScorecardPage() {
  const rawRows = computeScorecard(changelogEntries, results, opportunities, eventDecisions);
  const rows = enrichWithImpact(rawRows);

  rows.sort((a, b) => {
    if (a.operatorConfirmedCount !== b.operatorConfirmedCount)
      return b.operatorConfirmedCount - a.operatorConfirmedCount;
    return (b.topScore ?? -1) - (a.topScore ?? -1);
  });

  const allTopics = [
    ...new Set(rows.flatMap((r) => r.topics)),
  ].sort();
  const allPlatforms = [
    ...new Set(rows.flatMap((r) => r.platforms)),
  ].sort();

  const withEvents = rows.filter((r) => r.totalEventsLinked > 0).length;
  const operatorConfirmed = rows.filter((r) => r.operatorConfirmedCount > 0).length;
  const highConfidence = rows.filter((r) => r.impact.confidence === "high").length;

  const sortedContracts = [...changeContracts].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt)
  );

  return (
    <div>
      <PageHeader
        title="What You've Changed"
        description={`Log what changed so Beacon can compare it to the latest crawl and show tracked mentions over time — not proof of sales or rankings.`}
      />

      <ChangeContractUI
        contracts={sortedContracts}
        onCreateContract={createChangeContract}
        onVerifyContract={verifyChangeContract}
      />

      {/* Impact summary strip */}
      {withEvents > 0 && (
        <div className="mt-6 border border-border rounded-lg px-4 py-3 bg-surface-inset/30">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Impact snapshot
          </p>
          <div className="flex items-center gap-4 text-[12px] flex-wrap">
            <span><span className="font-semibold tabular-nums">{withEvents}</span> <span className="text-muted-foreground">changes with signal</span></span>
            {highConfidence > 0 && (
              <span><span className="font-semibold text-status-success tabular-nums">{highConfidence}</span> <span className="text-muted-foreground">high confidence</span></span>
            )}
            {operatorConfirmed > 0 && (
              <span><span className="font-semibold text-status-success tabular-nums">{operatorConfirmed}</span> <span className="text-muted-foreground">operator confirmed</span></span>
            )}
          </div>
        </div>
      )}

      <details className="group mt-6" open>
        <summary className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground mb-2">
          Full change table ({rows.length})
        </summary>
        <p className="text-[10px] text-muted-foreground mb-3">
          Detailed view for digging into links between edits and visibility signals.{withEvents > 0 ? ` ${withEvents} changes tied to at least one signal.` : ""}{operatorConfirmed > 0 ? ` ${operatorConfirmed} with your confirmation in Review.` : ""}
        </p>
        <ScorecardTable
          rows={rows}
          allTopics={allTopics}
          allPlatforms={allPlatforms}
        />
      </details>
    </div>
  );
}
