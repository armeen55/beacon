import "server-only";

import { exec } from "node:child_process";
import { promisify } from "node:util";

import { log } from "@/lib/logger";
import { changelogEntries } from "@/lib/seed-data.server";
import { getSiteConfig } from "@/lib/site-config";
import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type { CitationEvidenceIndex } from "@/domains/pages/types";
import type { GuardrailAlert } from "@/domains/pages/guardrails";
import type { PageSnapshot } from "@/domains/pages/types";

import { generateFindings } from "./detect-findings";
import { addFindings, getPreviouslyRejectedTypeKeys } from "./findings-store";
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
  });

  if (newFindings.length > 0) {
    await addFindings(newFindings);
  }
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
  const execEnv: NodeJS.ProcessEnv = {
    ...process.env,
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
