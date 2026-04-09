import { PageHeader } from "@/components/data/page-header";
import {
  changelogEntries,
  opportunities,
  results,
} from "@/lib/seed-data.server";
import { eventDecisions } from "@/domains/attribution/store";
import { computeScorecard } from "@/domains/attribution/scorecard";
import { ScorecardTable } from "./scorecard-client";
import { changeContracts } from "@/domains/changelog/change-contract";
import { ChangeContractUI } from "./change-contract-client";
import { createChangeContract, verifyChangeContract } from "./contract-actions";

export default async function ChangeScorecardPage() {
  const rows = computeScorecard(changelogEntries, results, opportunities, eventDecisions);

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

      <details className="group mt-6">
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
