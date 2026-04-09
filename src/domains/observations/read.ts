import { getRepository } from "@/lib/persistence/repositories";
import type { ObservationRun } from "./types";

const repo = getRepository();
const _runs = await repo.getObservationRuns();

function sortByCompleted(runs: ObservationRun[]): ObservationRun[] {
  return [...runs].sort(
    (a, b) =>
      new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime(),
  );
}

/**
 * All observation runs, newest first.
 * Repository layer handles merging typed observation-runs.json rows with
 * legacy scan-runs.json rows (file backend) or returning DB rows (supabase backend).
 */
export function listObservationRuns(): ObservationRun[] {
  return sortByCompleted(_runs);
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
