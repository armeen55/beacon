import { readDotDataJson, writeDotDataJson } from "@/lib/persistence/dotdata-json";

export const LAST_SCAN_RESULT_BASENAME = "last-scan-result";

/** CLI / orchestrator exit classification (persisted). */
export type ScanExitKind = "success" | "partial" | "failed" | "aborted";

export type LastScanResultPayload = {
  schemaVersion: 1;
  finishedAt: string;
  exit: ScanExitKind;
  /** Who invoked the scan (optional, set by orchestrator when known). */
  /** Orchestrator sets today/pages/import; CLI-only runs use `cli`;
   *  Phase 5 scheduled scans (GH Actions + /api/cron/scan) use `cron`.
   *  Imported from scan-state.ts as the canonical source so the union
   *  doesn't drift between the two files (the 2026-04-28 add of `cron`
   *  surfaced exactly this drift). */
  trigger?: import("./scan-state").ScanTrigger;
  /**
   * Phase 6D (2026-04-28) — execution-environment label.
   * Sourced from `BEACON_SCAN_SOURCE_LABEL` env var (set by GH Actions
   * workflow as `"github-actions-daily-scan"`; absent for local CLI/dev
   * runs so they remain identifiable as such). Persisted alongside
   * `trigger` so hosted vs local executions are distinguishable in the
   * durable scan output without GH Actions log spelunking.
   */
  source?: string;
  /**
   * Phase 6D (2026-04-28) — owning tenant resolved by the orchestrator
   * via `currentTenantId()`. Persisted so the durable record is tenant-
   * attributable without re-resolving from process env later.
   */
  tenantId?: string;
  observationRunId: string | null;
  pagesScanned: number;
  pagesChanged: number;
  pagesWithErrors: number;
  guardrailAlertCount: number;
  dryRun?: boolean;
  abortedReason?: string;
  /** Top-level CLI or sitemap failure before a run id was minted. */
  cliError?: string;
  fetchErrors?: { url: string; error: string }[];
  /**
   * Phase 6D (2026-04-28) — durable Recommendation Lifecycle OS runner
   * summary. Mirrors `RunLifecycleMatchResult` from the match-runner
   * plus the gate state at orchestration time (`enabled`) and whether
   * the runner was actually invoked vs. failed to load (`runnerCalled`).
   * Lets us audit lifecycle behavior of any past scan from this single
   * file without grepping GH Actions logs.
   */
  lifecycle?: {
    /** `isLifecycleEnabled()` value at orchestration time. */
    enabled: boolean;
    /** True when `runLifecycleMatchAgainstScan` returned (success or skipped). False when the dynamic import / invocation threw. */
    runnerCalled: boolean;
    ranSuccessfully?: boolean;
    skippedReason?: "flag_disabled" | "no_edits" | "error";
    reconciled?: number;
    evaluated?: number;
    updated?: number;
    liveAtStamped?: number;
    noStableAcceptTimestamp?: number;
    error?: string;
  };
};

/**
 * Phase 5 hosted-cron fix (2026-04-28).
 *
 * `writeLastScanResultFile` previously wrote directly to root
 * `.data/last-scan-result.json` via `writeFileSync`. The reader
 * (`readLastScanResult`) used `readDotDataJson` which routes via
 * `store-classification` — and `last-scan-result` is GLOBAL-classified,
 * so reads route to `.data/global/last-scan-result.json`.
 *
 * **Split-brain.** Local FS happened to have files in BOTH locations
 * from prior runs, masking the bug. The first GH Actions hosted scan
 * surfaced it cleanly: CLI wrote root, orchestrator read global → null
 * → "last-scan-result.json missing or invalid after CLI" → workflow
 * failure.
 *
 * Fix: writer now uses `writeDotDataJson` (auto-routes via the same
 * classification as the reader). Both writer + reader land on
 * `.data/global/last-scan-result.json`. Sync→async migration; all 9
 * call sites updated to await.
 */
export async function writeLastScanResultFile(
  payload: LastScanResultPayload,
): Promise<void> {
  await writeDotDataJson(LAST_SCAN_RESULT_BASENAME, payload);
}

export async function readLastScanResult(): Promise<LastScanResultPayload | null> {
  const raw = await readDotDataJson<LastScanResultPayload>(LAST_SCAN_RESULT_BASENAME);
  if (!raw || raw.schemaVersion !== 1) return null;
  return raw;
}
