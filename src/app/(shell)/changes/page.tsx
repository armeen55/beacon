import { PageHeader } from "@/components/data/page-header";
import {
  changelogEntries,
  opportunities,
  results,
} from "@/lib/seed-data.server";
import { eventDecisions } from "@/domains/attribution/store";
import { computeScorecard } from "@/domains/attribution/scorecard";
import { enrichWithImpact } from "@/domains/attribution/change-impact";
import { ScorecardTable, type ChangeIntelEntry } from "./scorecard-client";
import { changeContracts } from "@/domains/changelog/change-contract";
import { ChangeContractUI } from "./change-contract-client";
import { createChangeContract, verifyChangeContract } from "./contract-actions";
import { pageSnapshots } from "@/domains/pages/snapshot-store";
import { citationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import {
  rolloutExecutions,
  patternEvidence as persistedPatternEvidence,
} from "@/domains/pages/issues";
import { minePatterns, generateBriefs } from "@/domains/pages/playbook";
import {
  computeTrackRecord,
  wasChangeRecommended,
  matchChangeToPattern,
} from "@/domains/product/recommendation-tracker";

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

  // Recommendation intelligence: pattern mining + track record
  const citationIndex2 = citationEvidenceIndex as {
    by_page_and_topic: {
      page_url: string;
      is_owned: boolean;
      total_citations: number;
    }[];
    by_topic: { topic: string }[];
  } | null;
  const citMap = new Map<string, number>();
  if (citationIndex2) {
    for (const r of citationIndex2.by_page_and_topic) {
      if (!r.is_owned) continue;
      const key = r.page_url.replace(/\/+$/, "").toLowerCase();
      citMap.set(key, (citMap.get(key) ?? 0) + r.total_citations);
    }
  }
  const patterns = minePatterns(
    pageSnapshots,
    citMap,
    rawRows,
    rolloutExecutions,
    persistedPatternEvidence,
  );
  const briefs = generateBriefs(pageSnapshots, citMap, patterns);
  const trackRecord = computeTrackRecord({ impactRows: rows, patterns });

  const briefCountByPattern = new Map<string, number>();
  for (const b of briefs) {
    briefCountByPattern.set(b.patternId, (briefCountByPattern.get(b.patternId) ?? 0) + 1);
  }

  const changeIntel: Record<string, ChangeIntelEntry> = {};
  let beaconRecommendedCount = 0;
  let totalReplicationTargets = 0;

  for (const row of rows) {
    const match = wasChangeRecommended(row.change.id, trackRecord);

    let replicationCount = 0;
    let patternName: string | undefined;
    if (
      (row.verdict === "validated" || row.verdict === "partial") &&
      row.impact.direction === "positive"
    ) {
      const matchedPattern = matchChangeToPattern(row.change, patterns);
      if (matchedPattern) {
        replicationCount = briefCountByPattern.get(matchedPattern.id) ?? 0;
        patternName = matchedPattern.name;
      }
    }

    if (match || replicationCount > 0) {
      const entry: ChangeIntelEntry = {
        beaconRecommended: !!match,
        replicationCount,
      };
      if (match) {
        entry.matchConfidence = match.matchConfidence;
        entry.patternName = match.patternId
          .replace("pattern-", "")
          .replace(/-/g, " ");
      }
      if (replicationCount > 0 && patternName) {
        entry.patternName = entry.patternName ?? patternName;
      }
      changeIntel[row.change.id] = entry;
      if (match) beaconRecommendedCount++;
      totalReplicationTargets += replicationCount;
    }
  }

  const sortedContracts = [...changeContracts].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt)
  );

  return (
    <div>
      <PageHeader
        title="Changes"
        description="Outcome intelligence first — log new work and match scans below when you need the record."
      />

      {/* Impact snapshot — leads the page */}
      <div className="mb-6 rounded-lg border border-border/60 bg-surface-raised/40 px-5 py-4">
        <p className="text-xs font-medium text-muted-foreground mb-2">At a glance</p>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
          <span>
            <span className="font-bold tabular-nums">{rows.length}</span>
            <span className="text-muted-foreground ml-1.5">changes</span>
          </span>
          {withEvents > 0 && (
            <span>
              <span className="font-semibold tabular-nums">{withEvents}</span>
              <span className="text-muted-foreground ml-1.5">with visibility signal</span>
            </span>
          )}
          {highConfidence > 0 && (
            <span className="text-status-success font-semibold tabular-nums">
              {highConfidence} high-confidence impact
            </span>
          )}
          {operatorConfirmed > 0 && (
            <span className="text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">{operatorConfirmed}</span> confirmed in Review
            </span>
          )}
          {beaconRecommendedCount > 0 && (
            <span className="text-accent-primary font-medium tabular-nums">
              {beaconRecommendedCount} Beacon-highlighted
            </span>
          )}
          {totalReplicationTargets > 0 && (
            <span className="text-muted-foreground tabular-nums">
              {totalReplicationTargets} replication targets
            </span>
          )}
        </div>
      </div>

      <ScorecardTable
        rows={rows}
        allTopics={allTopics}
        allPlatforms={allPlatforms}
        changeIntel={changeIntel}
      />

      <div className="mt-10 border-t border-border/50 pt-8">
        <p className="text-xs font-medium text-muted-foreground mb-4">Records &amp; verification</p>
        <ChangeContractUI
          contracts={sortedContracts}
          onCreateContract={createChangeContract}
          onVerifyContract={verifyChangeContract}
        />
      </div>
    </div>
  );
}
