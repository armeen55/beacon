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
 *
 * Phase 7.8b-1 (2026-04-25): async because the underlying merged-read
 * is now async (tenant-aware routing in dotdata-json).
 */
export async function listObservationRuns(): Promise<ObservationRun[]> {
  return sortByCompleted(await readObservationRunsMergedSync());
}

/** Website crawls only — excludes `website_verify` and non-crawl run types. */
export async function listWebsiteCrawlRuns(): Promise<ObservationRun[]> {
  return (await listObservationRuns()).filter((r) => r.run_type === "website_crawl");
}

export async function getObservationRun(runId: string): Promise<ObservationRun | null> {
  return (await listObservationRuns()).find((r) => r.run_id === runId) ?? null;
}

export async function latestWebsiteCrawlRun(): Promise<ObservationRun | null> {
  const crawls = await listWebsiteCrawlRuns();
  return crawls[0] ?? null;
}
