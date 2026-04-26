import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type { ObservationRun } from "./types";

type LegacyScanRow = {
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
};

/**
 * Same merge as `fileBackend.getObservationRuns` — fresh read from disk
 * so callers always see appended crawl rows without a stale module cache.
 *
 * Phase 7.8b-1 (2026-04-25): name kept (`...Sync`) for code-archeology
 * stability, but the function is now async because `readDotDataJson`
 * is. All call sites are already inside async functions.
 */
export async function readObservationRunsMergedSync(): Promise<ObservationRun[]> {
  const raw = (await readDotDataJson<Record<string, unknown>[]>("observation-runs")) ?? [];
  const typed = raw.filter(
    (r): r is Record<string, unknown> & ObservationRun =>
      typeof r === "object" && r !== null && "run_type" in r,
  ) as ObservationRun[];

  const legacy = (await readDotDataJson<LegacyScanRow[]>("scan-runs")) ?? [];
  const existingIds = new Set(typed.map((r) => r.run_id));
  for (const row of legacy) {
    if (row?.run_id && !existingIds.has(row.run_id)) {
      typed.push({
        ...row,
        run_type: "website_crawl",
        source: "scan-runs.json (legacy)",
        status: "completed",
        scope_label: "Owned pages from sitemap scan (legacy row)",
        parser_version: undefined,
        baseline_run_id: null,
        tenant_id: "",
      });
    }
  }
  return typed;
}
