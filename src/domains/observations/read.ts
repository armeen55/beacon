import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import { getRepository } from "@/lib/persistence/repositories";
import type { ObservationRun } from "./types";

/**
 * Normalize legacy scan-runs.json rows into ObservationRun (read-time, no write).
 */
function fromScanRunLegacy(row: {
  run_id: string;
  started_at: string;
  completed_at: string;
  pages_scanned: number;
  pages_changed: number;
  pages_with_errors: number;
  guardrail_alerts: number;
  critical_count: number;
  regression_count: number;
  improvement_count: number;
}): ObservationRun {
  return {
    ...row,
    run_type: "website_crawl",
    source: "scan-runs.json (legacy)",
    status: "completed",
    scope_label: "Owned pages from sitemap scan (legacy row — no observation_run id on snapshots)",
    parser_version: undefined,
    baseline_run_id: null,
  };
}

const repo = getRepository();
const _repoRuns = await repo.getObservationRuns();

// Filter to valid ObservationRun rows (file backend may return ProfoundImportRun data
// from observation-runs.json which lacks `run_type`).
const _validRuns = _repoRuns.filter(
  (r) => typeof r === "object" && "run_type" in r,
);

function sortByCompleted(runs: ObservationRun[]): ObservationRun[] {
  return [...runs].sort(
    (a, b) =>
      new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime(),
  );
}

/**
 * All observation runs, newest first.
 * Uses repository data when valid rows exist; falls back to scan-runs.json (legacy).
 */
export function listObservationRuns(): ObservationRun[] {
  if (_validRuns.length > 0) {
    return sortByCompleted(_validRuns);
  }
  const legacy = readDotDataJson<Parameters<typeof fromScanRunLegacy>[0][]>(
    "scan-runs"
  );
  if (!legacy?.length) return [];
  return sortByCompleted(legacy.map(fromScanRunLegacy));
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
