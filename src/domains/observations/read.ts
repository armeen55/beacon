import { readDotDataJson } from "@/lib/persistence/dotdata-json";
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

/**
 * All observation runs, newest first. Prefers `observation-runs.json`, falls back to `scan-runs.json`.
 */
export function listObservationRuns(): ObservationRun[] {
  const primary = readDotDataJson<ObservationRun[]>("observation-runs");
  if (primary?.length) {
    return [...primary].sort(
      (a, b) =>
        new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime()
    );
  }
  const legacy = readDotDataJson<Parameters<typeof fromScanRunLegacy>[0][]>(
    "scan-runs"
  );
  if (!legacy?.length) return [];
  return [...legacy]
    .sort(
      (a, b) =>
        new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime()
    )
    .map(fromScanRunLegacy);
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
