import "server-only";

import { getRepository } from "@/lib/persistence/repositories";
import type { ObservationRun } from "./types";
import { readObservationRunsMergedSync } from "./observation-runs-merge";

const repo = getRepository();

const supabaseCachedRuns: ObservationRun[] =
  process.env.DATA_SOURCE === "supabase"
    ? await repo.getObservationRuns()
    : [];

function sortByCompleted(runs: ObservationRun[]): ObservationRun[] {
  return [...runs].sort(
    (a, b) =>
      new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime(),
  );
}

/**
 * All observation runs, newest first.
 * **File `DATA_SOURCE`:** reads merged `observation-runs` + legacy `scan-runs` from disk each call.
 * **Supabase:** uses the snapshot loaded at module init (same limitation as before this refactor).
 */
export function listObservationRuns(): ObservationRun[] {
  if (process.env.DATA_SOURCE === "supabase") {
    return sortByCompleted(supabaseCachedRuns);
  }
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
