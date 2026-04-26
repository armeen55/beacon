import "server-only";

import { exec } from "node:child_process";
import { promisify } from "node:util";

import { log } from "@/lib/logger";
import { currentTenantId } from "@/lib/tenant-context";
import { changelogEntries } from "@/lib/seed-data.server";
import { getSiteConfig } from "@/lib/site-config";
import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type { CitationEvidenceIndex } from "@/domains/pages/types";
import type { GuardrailAlert } from "@/domains/pages/guardrails";
import type { PageSnapshot } from "@/domains/pages/types";

import { generateFindings } from "./detect-findings";
import { addFindings, getPreviouslyRejectedTypeKeys } from "./findings-store";
import {
  refreshRobotsState,
  readRobotsState,
} from "@/domains/pages/robots-parser";
import {
  syncPageSnapshots,
  syncGuardrailAlerts,
  syncObservationRuns,
  syncPageElementInventory,
} from "@/lib/persistence/dual-write";
import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import type { LastScanResultPayload } from "./last-scan-result";
import { readLastScanResult, writeLastScanResultFile } from "./last-scan-result";
import type { ScanTrigger } from "./scan-state";
import {
  readScanState,
  isScanRunningAndFresh,
  runningScanAgeMs,
  STALE_SCAN_THRESHOLD_MS,
  writeIdleScanStateFromLastResult,
  writeRunningScanState,
} from "./scan-state";
import { resolveBeaconSiteDomainForScan } from "./scan-site-domain";
import { getPageSnapshots } from "@/domains/pages/snapshot-store";
import { getGuardrailAlerts } from "@/domains/pages/guardrail-store";

const execAsync = promisify(exec);

const SCAN_CLI_CMD =
  "npx tsx --require ./scripts/mock-server-only.cjs --require ./scripts/apply-scan-site-domain.cjs scripts/scan-owned-pages.ts";

export type WebsiteScanResult = {
  ok: boolean;
  phase: LastScanResultPayload["exit"] | "running" | "failed";
  payload: LastScanResultPayload | null;
  findingsAdded: number;
  error?: string;
};

/** Use after `runWebsiteScan` from server actions — not during RSC render. */
export function scanRoutesShouldRevalidate(r: WebsiteScanResult): boolean {
  const p = r.payload;
  if (!p || p.dryRun) return false;
  if (p.exit === "failed" || p.exit === "aborted") return false;
  return true;
}

function buildCitationLookup(index: CitationEvidenceIndex | null): Map<string, number> {
  const citLookup = new Map<string, number>();
  if (!index) return citLookup;
  for (const rollup of index.by_page_and_topic) {
    if (rollup.is_owned) {
      const key = rollup.page_url.replace(/\/+$/, "").toLowerCase();
      citLookup.set(key, (citLookup.get(key) ?? 0) + rollup.total_citations);
    }
  }
  return citLookup;
}

/**
 * After a successful CLI write, diff snapshots vs pre-scan baselines and persist findings.
 */
export async function regenerateScanFindings(opts: {
  previousSnapshots: PageSnapshot[];
  previousGuardrails: GuardrailAlert[];
  scanRunId: string;
}): Promise<number> {
  const freshSnapshots =
    readDotDataJson<PageSnapshot[]>("page-snapshots") ?? [];
  const freshGuardrails =
    readDotDataJson<GuardrailAlert[]>("page-guardrails") ?? [];

  const citationIndex = readDotDataJson<CitationEvidenceIndex>(
    "citation-evidence-index",
  );
  const citLookup = buildCitationLookup(citationIndex);
  const { siteDomain } = getSiteConfig();
  const homepageUrl = `https://${siteDomain}/`;
  const previouslyRejectedTypes = getPreviouslyRejectedTypeKeys();

  // G9: refresh robots.txt state before emitting findings. Degrades gracefully —
  // if the fetch fails or no rules exist, we just pass a null so the robots
  // detection branch in generateFindings is a no-op. Never blocks the scan.
  let robots = null;
  try {
    const refreshed = await refreshRobotsState(siteDomain);
    robots = refreshed.parsed;
  } catch (err) {
    log.warn("robots.txt refresh failed (continuing scan)", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Fallback to cached state if present.
    const cached = readRobotsState();
    robots = cached?.parsed ?? null;
  }

  const newFindings = generateFindings({
    currentSnapshots: freshSnapshots,
    previousSnapshots: opts.previousSnapshots,
    currentGuardrails: freshGuardrails,
    previousGuardrails: opts.previousGuardrails,
    changelog: changelogEntries,
    scanRunId: opts.scanRunId,
    citationsByUrl: citLookup,
    homepageUrl,
    previouslyRejectedTypes,
    robots,
  });

  // Always call addFindings — even with empty array — so the full findings
  // store is written and synced to Supabase (prune + dual-write on every scan).
  await addFindings(newFindings);
  return newFindings.length;
}

/** Coarse operator vs pipeline signal for logs (import post-step = auto). */
function scanLogTrigger(entry: ScanTrigger): "manual" | "auto" {
  return entry === "import" ? "auto" : "manual";
}

function defaultFailedPayload(
  err: string,
  trigger: ScanTrigger,
): LastScanResultPayload {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    finishedAt: now,
    exit: "failed",
    trigger,
    observationRunId: null,
    pagesScanned: 0,
    pagesChanged: 0,
    pagesWithErrors: 0,
    guardrailAlertCount: 0,
    cliError: err.slice(0, 2000),
  };
}

/**
 * Render-safe: run CLI, read/write scan state + `last-scan-result`, regenerate findings.
 * Callers in mutation boundaries (server actions) must invalidate Next.js cache routes after success.
 */
export async function runWebsiteScan(opts: {
  trigger: ScanTrigger;
}): Promise<WebsiteScanResult> {
  const { trigger } = opts;
  const runId = `scan-${Date.now()}`;
  const startedAt = Date.now();
  // Phase 7.7b Commit 3 (2026-04-25): resolve tenantId once at the top
  // and thread it into the dual-write block. Child-process env injection
  // (Phase 7.7e) deferred — the spawned CLI still inherits BEACON_TENANT_ID
  // implicitly from the parent process.
  const tenantId = await currentTenantId();

  // ── Stale-running detection & duplicate guard ──
  const priorState = readScanState();
  if (priorState?.phase === "running") {
    if (isScanRunningAndFresh(priorState)) {
      log.warn("Scan already running", { runId, trigger });
      return {
        ok: false,
        phase: "running",
        payload: null,
        findingsAdded: 0,
        error: "A scan is already in progress",
      };
    }
    const ageMs = runningScanAgeMs(priorState) ?? 0;
    log.warn("Scan marked stale", {
      runId: priorState.trigger ? `stale-${priorState.trigger}` : "stale-unknown",
      ageMs,
      thresholdMs: STALE_SCAN_THRESHOLD_MS,
    });
    const stalePayload = defaultFailedPayload(
      `Previous scan stuck in running state for ${Math.round(ageMs / 1000)}s — recovered`,
      priorState.trigger ?? trigger,
    );
    writeIdleScanStateFromLastResult(priorState.trigger ?? trigger, stalePayload);
    log.info("Recovered stale scan state", { runId });
  }

  const previousSnapshots = [...getPageSnapshots()];
  const previousGuardrails = [...getGuardrailAlerts()];

  log.info("Scan started", {
    runId,
    trigger: scanLogTrigger(trigger),
    siteDomain: getSiteConfig().siteDomain,
    baselineSnapshots: previousSnapshots.length,
    baselineGuardrails: previousGuardrails.length,
  });

  writeRunningScanState(trigger);

  log.info("Scan step", { runId, step: "cli_spawn", cmd: SCAN_CLI_CMD });

  const scanDomain = resolveBeaconSiteDomainForScan();
  // Phase 7.7e (2026-04-25): explicit BEACON_TENANT_ID injection.
  // The spawned CLI (scripts/scan-owned-pages.ts) requires the env var
  // (Phase 7.5d fail-loud). Until now we relied on implicit inheritance
  // via `...process.env`; making it explicit hardens the contract so
  // a future caller who runs `runWebsiteScan` from a context where
  // process.env.BEACON_TENANT_ID is not set still propagates the
  // resolved tenantId from currentTenantId() — header → env → throw.
  const execEnv: NodeJS.ProcessEnv = {
    ...process.env,
    BEACON_TENANT_ID: tenantId,
    NODE_NO_WARNINGS: "1",
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
  };
  if (!execEnv.BEACON_SITE_DOMAIN?.trim() && scanDomain) {
    execEnv.BEACON_SITE_DOMAIN = scanDomain;
    log.info("Scan step", { runId, step: "inferred_site_domain", siteDomain: scanDomain });
  }

  try {
    await execAsync(SCAN_CLI_CMD, {
      cwd: process.cwd(),
      timeout: 120_000,
      env: execEnv,
    });
    log.info("Scan step", { runId, step: "cli_exited_zero" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startedAt;
    log.error("Scan failed", {
      runId,
      durationMs,
      step: "cli_exec",
      error: msg.slice(0, 500),
    });
    const payload = defaultFailedPayload(msg, trigger);
    writeLastScanResultFile(payload);
    writeIdleScanStateFromLastResult(trigger, payload);
    return {
      ok: false,
      phase: "failed",
      payload,
      findingsAdded: 0,
      error: msg.slice(0, 500),
    };
  }

  log.info("Scan step", { runId, step: "read_last_scan_result" });

  const payload = readLastScanResult();
  if (!payload) {
    const durationMs = Date.now() - startedAt;
    log.error("Scan failed", {
      runId,
      durationMs,
      step: "read_last_scan_result",
      error: "last-scan-result.json missing or invalid after CLI",
    });
    const fallback = defaultFailedPayload(
      "Scan finished but last-scan-result.json is missing or invalid",
      trigger,
    );
    writeLastScanResultFile(fallback);
    writeIdleScanStateFromLastResult(trigger, fallback);
    return {
      ok: false,
      phase: "failed",
      payload: fallback,
      findingsAdded: 0,
      error: fallback.cliError,
    };
  }

  const merged: LastScanResultPayload = {
    ...payload,
    trigger: payload.trigger ?? trigger,
    finishedAt: payload.finishedAt,
  };

  let findingsAdded = 0;
  if (merged.exit !== "aborted" && !merged.dryRun) {
    const scanRunId = merged.observationRunId ?? `scan-${Date.now()}`;
    log.info("Scan step", { runId, step: "regenerate_findings_start", scanRunId });
    findingsAdded = await regenerateScanFindings({
      previousSnapshots,
      previousGuardrails,
      scanRunId,
    });
    log.info("Scan step", { runId, step: "regenerate_findings_done", findingsAdded });

    // Phase 11: enrich findings with signal quality (best-effort)
    try {
      const { enrichFindingsWithSignalQuality } = await import("./findings-store");
      const { readDotDataJson: readDotData } = await import("@/lib/persistence/dotdata-json");
      const { dailyMetricSnapshots: dms } = await import("@/storage/canonical-store");
      await enrichFindingsWithSignalQuality({
        citationIndex: readDotData<import("@/domains/pages/types").CitationEvidenceIndex>("citation-evidence-index"),
        snapshots: dms,
      });
      log.info("Scan step", { runId, step: "findings_enrichment_done" });
    } catch (e) {
      log.warn("Finding enrichment failed", {
        runId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Phase 12: triage rule learning (best-effort, passive storage only)
    try {
      const { materializeTriageRules } = await import("@/domains/learning/triage-rules");
      const { getFindings: getAllFindings } = await import("./findings-store");
      await materializeTriageRules(getAllFindings());
      log.info("Scan step", { runId, step: "triage_rules_done" });
    } catch (e) {
      log.warn("Triage rule learning failed", {
        runId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Dual-write scan outputs to Supabase (best-effort, errors logged)
    const syncSnaps =
      readDotDataJson<PageSnapshot[]>("page-snapshots") ?? [];
    const syncGuards =
      readDotDataJson<GuardrailAlert[]>("page-guardrails") ?? [];
    await syncPageSnapshots(syncSnaps, tenantId);
    await syncGuardrailAlerts(syncGuards, tenantId);
    const syncRuns =
      readDotDataJson<import("@/domains/observations/types").ObservationRun[]>(
        "observation-runs",
      ) ?? [];
    if (syncRuns.length > 0) {
      await syncObservationRuns(syncRuns, tenantId);
    }

    // Sprint 6A.1 Phase 6 — dual-write the inventory rows the CLI wrote
    // to `.data/page-element-inventory.json`. Idempotent on
    // `(source_snapshot_id, element_key)` so re-runs replace in place.
    // Best-effort — failure here must not regress the scan.
    let inventoryRowCount = 0;
    try {
      const syncInventory =
        readDotDataJson<PageElementInventoryRow[]>(
          "page-element-inventory",
        ) ?? [];
      if (syncInventory.length > 0) {
        await syncPageElementInventory(syncInventory, tenantId);
        inventoryRowCount = syncInventory.length;
      }
    } catch (e) {
      log.warn("Page element inventory dual-write failed", {
        runId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    log.info("Scan step", {
      runId,
      step: "dual_write_scan_outputs",
      snapshots: syncSnaps.length,
      guardrails: syncGuards.length,
      observationRuns: syncRuns.length,
      pageElements: inventoryRowCount,
    });
  }

  writeLastScanResultFile(merged);
  writeIdleScanStateFromLastResult(trigger, merged);

  const ok =
    merged.exit === "success" ||
    (merged.exit === "partial" && merged.pagesScanned > 0);

  const durationMs = Date.now() - startedAt;
  if (ok) {
    log.info("Scan completed", {
      runId,
      durationMs,
      resultCount: merged.pagesScanned,
    });
  } else {
    const errMsg =
      merged.cliError?.slice(0, 500) ??
      (merged.exit === "aborted" ? "aborted" : merged.exit);
    log.error("Scan failed", { runId, durationMs, error: errMsg });
  }

  return {
    ok,
    phase: merged.exit === "aborted" ? "failed" : merged.exit,
    payload: merged,
    findingsAdded,
  };
}
