import "server-only";

import { exec } from "node:child_process";
import { promisify } from "node:util";

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
  writeIdleScanStateFromLastResult,
  writeRunningScanState,
} from "./scan-state";
import { getPageSnapshots } from "@/domains/pages/snapshot-store";
import { getGuardrailAlerts } from "@/domains/pages/guardrail-store";

const execAsync = promisify(exec);

const SCAN_CLI_CMD =
  "npx tsx --require ./scripts/mock-server-only.cjs scripts/scan-owned-pages.ts";

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
  const previousSnapshots = [...getPageSnapshots()];
  const previousGuardrails = [...getGuardrailAlerts()];

  writeRunningScanState(trigger);

  try {
    await execAsync(SCAN_CLI_CMD, {
      cwd: process.cwd(),
      timeout: 120_000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
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

  const payload = readLastScanResult();
  if (!payload) {
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
    findingsAdded = await regenerateScanFindings({
      previousSnapshots,
      previousGuardrails,
      scanRunId,
    });
  }

  writeLastScanResultFile(merged);
  writeIdleScanStateFromLastResult(trigger, merged);

  const ok =
    merged.exit === "success" ||
    (merged.exit === "partial" && merged.pagesScanned > 0);

  return {
    ok,
    phase: merged.exit === "aborted" ? "failed" : merged.exit,
    payload: merged,
    findingsAdded,
  };
}
