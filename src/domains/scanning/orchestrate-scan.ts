import "server-only";

import { exec } from "node:child_process";
import { promisify } from "node:util";

import { log } from "@/lib/logger";
import { currentTenantId } from "@/lib/tenant-context";
import { getChangelogEntries } from "@/lib/seed-data.server";
import { getSiteConfig } from "@/lib/site-config";
import { isLifecycleEnabled } from "@/lib/flags";
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
  const tenantId = await currentTenantId();
  const freshSnapshots =
    (await readDotDataJson<PageSnapshot[]>("page-snapshots")) ?? [];
  const freshGuardrails =
    (await readDotDataJson<GuardrailAlert[]>("page-guardrails")) ?? [];

  const citationIndex = await readDotDataJson<CitationEvidenceIndex>(
    "citation-evidence-index",
  );
  const citLookup = buildCitationLookup(citationIndex);
  const { siteDomain } = getSiteConfig();
  const homepageUrl = `https://${siteDomain}/`;
  const previouslyRejectedTypes = await getPreviouslyRejectedTypeKeys();

  // G9: refresh robots.txt state before emitting findings. Degrades gracefully —
  // if the fetch fails or no rules exist, we just pass a null so the robots
  // detection branch in generateFindings is a no-op. Never blocks the scan.
  let robots = null;
  try {
    const refreshed = await refreshRobotsState({ siteDomain, tenantId });
    robots = refreshed.parsed;
  } catch (err) {
    log.warn("robots.txt refresh failed (continuing scan)", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Fallback to cached state if present. Phase A.3 (post-A.3.5):
    // readRobotsState is now async + tenant-scoped, reads from
    // Supabase mirror via repository.
    const cached = await readRobotsState({ tenantId });
    robots = cached?.parsed ?? null;
  }

  const newFindings = generateFindings({
    currentSnapshots: freshSnapshots,
    previousSnapshots: opts.previousSnapshots,
    currentGuardrails: freshGuardrails,
    previousGuardrails: opts.previousGuardrails,
    changelog: await getChangelogEntries(),
    scanRunId: opts.scanRunId,
    tenantId,
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
  // Phase 5 (2026-04-28): "cron" is automation, not a click-driven
  // operator action. Mapping it to "manual" was misleading in
  // production logs (Daily scheduled scan #1 logged trigger="manual"
  // even though scripts/run-scheduled-scan.ts called runWebsiteScan
  // with trigger:"cron"). Operator-driven triggers (today/pages/cli)
  // remain "manual"; cron + import are automation.
  return entry === "import" || entry === "cron" ? "auto" : "manual";
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

  const previousSnapshots = [...(await getPageSnapshots())];
  const previousGuardrails = [...(await getGuardrailAlerts())];

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

  // CLI timeout scales with the crawl ceiling (P0 wall 2, 2026-06-10).
  // 120s fit Ritz's ~80 serial fetches but killed encyclopedia-scale
  // tenants mid-crawl. Budget ~1s/page on top of a 120s floor, capped
  // at 25 min (inside the workflow job's 30-min timeout).
  const envCap = Number.parseInt(process.env.BEACON_SCAN_MAX_PAGES ?? "", 10);
  const pageBudget = Number.isFinite(envCap) && envCap > 0 ? envCap : 1500;
  const cliTimeoutMs = Math.min(120_000 + pageBudget * 1_000, 25 * 60_000);
  try {
    await execAsync(SCAN_CLI_CMD, {
      cwd: process.cwd(),
      timeout: cliTimeoutMs,
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
    await writeLastScanResultFile(payload);
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

  const payload = await readLastScanResult();
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
    await writeLastScanResultFile(fallback);
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
    // Phase 6D follow-up (2026-04-28): orchestrator wins over CLI-emitted
    // trigger. The CLI hardcodes `trigger: "cli"` because it doesn't know
    // who invoked it (every scan-owned-pages.ts call site sets "cli").
    // Pre-fix `payload.trigger ?? trigger` always picked the CLI value,
    // making cron-triggered runs incorrectly read trigger="cli" in the
    // durable record. The orchestrator's `trigger` is the authoritative
    // higher-level context, so it should always win.
    trigger,
    finishedAt: payload.finishedAt,
  };

  // Phase 6D (2026-04-28) — declared at function scope so the augment
  // block below can read it. Stays `undefined` for aborted/dryRun
  // scans since the lifecycle runner never enters its critical block.
  let lifecycleSummary: LastScanResultPayload["lifecycle"] | undefined;

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
      const { getDailyMetricSnapshots } = await import("@/storage/canonical-store");
      const dms = await getDailyMetricSnapshots();
      await enrichFindingsWithSignalQuality({
        citationIndex: await readDotData<import("@/domains/pages/types").CitationEvidenceIndex>("citation-evidence-index"),
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
      await materializeTriageRules(await getAllFindings());
      log.info("Scan step", { runId, step: "triage_rules_done" });
    } catch (e) {
      log.warn("Triage rule learning failed", {
        runId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Dual-write scan outputs to Supabase (best-effort, errors logged).
    //
    // audit wave-2 #2 (2026-06-14): these were NOT individually guarded
    // despite the "best-effort, errors logged" promise — and dualWriteUpsert
    // DELIBERATELY re-throws on transient/persistent failure (the Bug-1 fix).
    // So a transient PostgREST/network blip in syncPageSnapshots propagated
    // out of runWebsiteScan → run-scheduled-scan.ts process.exit(2), which
    // (a) skipped the website_crawl observation_run heartbeat below — the
    // row the poll-watchdog keys recovery on, forcing a wasteful full
    // re-dispatch of daily-scan.yml — and (b) skipped the lifecycle live_at
    // stamping further down. Each write now fails soft on its own (matching
    // the inventory dual-write just below), so one connector blip degrades
    // only that write. The website_crawl heartbeat is persisted in its own
    // guarded step so it lands even if a snapshot/guardrail write blips.
    const syncSnaps =
      (await readDotDataJson<PageSnapshot[]>("page-snapshots")) ?? [];
    const syncGuards =
      (await readDotDataJson<GuardrailAlert[]>("page-guardrails")) ?? [];
    try {
      await syncPageSnapshots(syncSnaps, tenantId);
    } catch (e) {
      log.warn("Page snapshots dual-write failed", {
        runId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    try {
      await syncGuardrailAlerts(syncGuards, tenantId);
    } catch (e) {
      log.warn("Guardrail alerts dual-write failed", {
        runId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    let syncRunsLen = 0;
    try {
      const syncRuns =
        (await readDotDataJson<import("@/domains/observations/types").ObservationRun[]>(
          "observation-runs",
        )) ?? [];
      syncRunsLen = syncRuns.length;
      if (syncRuns.length > 0) {
        await syncObservationRuns(syncRuns, tenantId);
      }
    } catch (e) {
      log.warn("Observation runs (website_crawl heartbeat) dual-write failed", {
        runId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Sprint 6A.1 Phase 6 — dual-write the inventory rows the CLI wrote
    // to `.data/page-element-inventory.json`. Idempotent on
    // `(source_snapshot_id, element_key)` so re-runs replace in place.
    // Best-effort — failure here must not regress the scan.
    let inventoryRowCount = 0;
    try {
      const syncInventory =
        (await readDotDataJson<PageElementInventoryRow[]>(
          "page-element-inventory",
        )) ?? [];
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
      observationRuns: syncRunsLen,
      pageElements: inventoryRowCount,
    });

    // Recommendation Lifecycle OS — Phase 3 (2026-04-27).
    // Gated by `BEACON_LIFECYCLE_ENABLED` (default OFF). When OFF
    // the runner is a byte-identical no-op — no repo reads, no
    // writes. When ON: reconciliation pre-pass + match engine + per-
    // edit lifecycle status writes + opportunistic changelog
    // `live_at` stamps. NEVER throws upward — all errors caught
    // inside the runner. Best-effort: a runner failure must not
    // regress scan completion.
    //
    // Phase 6D (2026-04-28): capture the runner result + gate state
    // into `lifecycleSummary` so the durable last-scan-result record
    // includes a full audit trail (enabled / runnerCalled / counts /
    // skippedReason / error) without needing GH Actions log access.
    const lifecycleEnabled = isLifecycleEnabled();
    lifecycleSummary = {
      enabled: lifecycleEnabled,
      runnerCalled: false,
    };
    try {
      const { runLifecycleMatchAgainstScan } = await import(
        "@/domains/recommendations/match-runner"
      );
      const lifecycleResult = await runLifecycleMatchAgainstScan({
        tenantId,
      });
      lifecycleSummary = {
        enabled: lifecycleEnabled,
        runnerCalled: true,
        ranSuccessfully: lifecycleResult.ranSuccessfully,
        skippedReason: lifecycleResult.skippedReason,
        reconciled: lifecycleResult.reconciled,
        evaluated: lifecycleResult.evaluated,
        updated: lifecycleResult.updated,
        liveAtStamped: lifecycleResult.liveAtStamped,
        noStableAcceptTimestamp: lifecycleResult.noStableAcceptTimestamp,
        error: lifecycleResult.error,
      };
      if (lifecycleResult.ranSuccessfully) {
        log.info("Scan step", {
          runId,
          step: "lifecycle_match_done",
          reconciled: lifecycleResult.reconciled,
          evaluated: lifecycleResult.evaluated,
          updated: lifecycleResult.updated,
          liveAtStamped: lifecycleResult.liveAtStamped,
        });
      }
    } catch (e) {
      // The runner itself catches; a throw here means dynamic-import
      // failure or similar. Log loud, continue scan completion.
      const errMsg = e instanceof Error ? e.message : String(e);
      lifecycleSummary = {
        enabled: lifecycleEnabled,
        runnerCalled: false,
        error: errMsg,
      };
      log.warn("Lifecycle match runner failed", {
        runId,
        error: errMsg,
      });
    }
  }

  // Phase 6D (2026-04-28) — augment the durable scan record with
  // execution-environment metadata + lifecycle summary. Additive;
  // older readers ignore unknown fields.
  merged.source = process.env.BEACON_SCAN_SOURCE_LABEL?.trim() || undefined;
  merged.tenantId = tenantId;
  if (lifecycleSummary) {
    merged.lifecycle = lifecycleSummary;
  }

  await writeLastScanResultFile(merged);
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
