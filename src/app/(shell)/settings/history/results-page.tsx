import {
  results,
  changelogEntries,
  opportunities,
  competitors,
} from "@/lib/seed-data.server";
import { eventDecisions } from "@/domains/attribution/store";
import {
  buildAttributionDriverMap,
  type ResultDriverInfo,
} from "@/domains/attribution/result-drivers";
import { ResultsClient } from "./results-client";
import { latestWebsiteCrawlRun } from "@/domains/observations/read";
import {
  citationRollupVisibilityRun,
} from "@/domains/observations/visibility-read";
import { visibilitySampleStaleVsCrawl } from "@/domains/observations/staleness";
import { primaryVisibilityRunForResults } from "@/domains/observations/visibility-context";
import { loadCompetitorUniverseRuntime } from "@/domains/competitors/universe-read";
import { buildResultsCompetitorUniverseSummary } from "@/domains/competitors/universe-banners";
import { computeMarketBenchmark } from "@/domains/pages/builder-benchmark";
import { citationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import type { PersistedIssue } from "@/domains/pages/issues";

export default async function ResultsPage() {
  const driverMap = buildAttributionDriverMap(
    results,
    changelogEntries,
    opportunities,
    eventDecisions
  );

  const drivers: Record<string, ResultDriverInfo> = {};
  for (const [k, v] of driverMap) {
    drivers[k] = v;
  }

  const crawl = await latestWebsiteCrawlRun();
  const primaryVisibility = primaryVisibilityRunForResults(results);
  const rollupForStale = citationRollupVisibilityRun();
  const { stale: visibilityStaleVsCrawl, note: staleNote } =
    visibilitySampleStaleVsCrawl(rollupForStale, crawl?.completed_at ?? null);

  const universeRuntime = await loadCompetitorUniverseRuntime();
  const citIdx = citationEvidenceIndex;
  const competitorUniverseSummary =
    citIdx && citIdx.by_topic?.length
      ? buildResultsCompetitorUniverseSummary(
          universeRuntime,
          computeMarketBenchmark(citIdx, [] as PersistedIssue[]).topCompetitors.map(
            (c) => ({
              domain: c.domain,
              name: c.name,
              mentions: c.mentions,
            })
          ),
          competitors.map((c) => c.domain),
          primaryVisibility
        )
      : null;

  return (
    <ResultsClient
      results={results}
      changelogEntries={changelogEntries}
      opportunities={opportunities}
      drivers={drivers}
      sampleObservation={{
        importedRowCount: results.length,
        visibilityRunId: primaryVisibility?.run_id ?? null,
        visibilityRunHref: primaryVisibility
          ? `/observations/${encodeURIComponent(primaryVisibility.run_id)}`
          : null,
        visibilitySynthetic: primaryVisibility?.is_synthetic_wrapper ?? false,
        visibilityScopeLabel: primaryVisibility?.scope_label ?? null,
        latestCrawlCompletedAt: crawl?.completed_at ?? null,
        visibilityStaleVsCrawl,
        staleNote,
        rollupStalenessNote:
          rollupForStale && rollupForStale.run_id !== primaryVisibility?.run_id
            ? `Citation rollup run (staleness clock): ${rollupForStale.run_id}`
            : null,
        competitorUniverseSummary,
      }}
    />
  );
}
