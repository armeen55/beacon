import "server-only";

import type { ObservationRun } from "./types";
import { readObservationRunsMergedSync } from "./observation-runs-merge";

function sortByCompleted(runs: ObservationRun[]): ObservationRun[] {
  return [...runs].sort(
    (a, b) =>
      new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime(),
  );
}

/**
 * All observation runs, newest first.
 * Always reads from `.data/` files on disk (merged observation-runs + legacy scan-runs).
 * This ensures scan CLI writes are immediately visible without module cache staleness.
 */
export function listObservationRuns(): ObservationRun[] {
  return sortByCompleted(readObservationRunsMergedSync());
}

/** Website crawls only — excludes `website_verify` and non-crawl run types. */
export function listWebsiteCrawlRuns(): ObservationRun[] {
  return listObservationRuns().filter((r) => r.run_type === "website_crawl");
}

export function getObservationRun(runId: string): ObservationRun | null {
  return listObservationRuns().find((r) => r.run_id === runId) ?? null;
}

export function latestWebsiteCrawlRun(): ObservationRun | null {
  const crawls = listWebsiteCrawlRuns();
  return crawls[0] ?? null;
}
