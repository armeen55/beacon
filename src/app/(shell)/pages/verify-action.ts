"use server";

import { revalidatePath } from "next/cache";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { extractPageSnapshot } from "@/domains/pages/extractor";
import { diffSnapshots } from "@/domains/pages/snapshot-diff";
import { classifyGuardrails, type GuardrailAlert } from "@/domains/pages/guardrails";
import type { PageSnapshot, PageSnapshotDiff } from "@/domains/pages/types";
import type { ObservationRun } from "@/domains/observations/types";
import { OBSERVATION_RUN_PARSER_VERSION } from "@/domains/observations/types";
import { appendObservationRunSync } from "@/domains/observations/persist-run";
import { universeFieldsForObservationPersistence } from "@/domains/competitors/universe-run-pin";

const DATA_DIR = join(process.cwd(), ".data");

export type VerifyResult = {
  success: boolean;
  url: string;
  previousAlertCount: number;
  currentAlertCount: number;
  cleared: string[];
  remaining: string[];
  diff: {
    changed: boolean;
    summary: string;
  } | null;
  error?: string;
  /** Populated on success — live fetch run stamped on snapshot + observation-runs.json */
  verificationObservationRunId?: string;
  verificationBaselineObservationRunId?: string | null;
};

function countGuardrailBuckets(alerts: GuardrailAlert[]): Pick<
  ObservationRun,
  | "critical_count"
  | "regression_count"
  | "improvement_count"
  | "guardrail_alerts"
> {
  let critical_count = 0;
  let regression_count = 0;
  let improvement_count = 0;
  for (const a of alerts) {
    if (a.severity === "critical") critical_count++;
    else if (a.severity === "regression") regression_count++;
    else if (a.severity === "improvement") improvement_count++;
  }
  return {
    guardrail_alerts: alerts.length,
    critical_count,
    regression_count,
    improvement_count,
  };
}

export async function verifyPageFix(url: string): Promise<VerifyResult> {
  const base: VerifyResult = {
    success: false,
    url,
    previousAlertCount: 0,
    currentAlertCount: 0,
    cleared: [],
    remaining: [],
    diff: null,
  };

  try {
    // Load previous alerts for this URL
    const gPath = join(DATA_DIR, "page-guardrails.json");
    let prevAlerts: GuardrailAlert[] = [];
    if (existsSync(gPath)) {
      const all = JSON.parse(readFileSync(gPath, "utf8")) as GuardrailAlert[];
      prevAlerts = all.filter(
        (a) => a.url.replace(/\/+$/, "").toLowerCase() === url.replace(/\/+$/, "").toLowerCase()
      );
    }
    base.previousAlertCount = prevAlerts.length;

    // Load previous snapshot
    const snapPath = join(DATA_DIR, "page-snapshots.json");
    let prevSnapshot: PageSnapshot | null = null;
    let allSnapshots: PageSnapshot[] = [];
    if (existsSync(snapPath)) {
      allSnapshots = JSON.parse(readFileSync(snapPath, "utf8")) as PageSnapshot[];
      prevSnapshot = allSnapshots.find(
        (s) => s.url.replace(/\/+$/, "").toLowerCase() === url.replace(/\/+$/, "").toLowerCase()
      ) ?? null;
    }

    // Fetch + extract new snapshot
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BeaconVerify/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    clearTimeout(timer);

    const html = await res.text();
    const pageId = prevSnapshot?.page_id ?? `verify-${Date.now()}`;
    const newSnapshot = extractPageSnapshot(html, url, pageId, res.status);
    const baselineRunId = prevSnapshot?.observation_run_id ?? null;
    const verifyRunId = `obs-verify-${Date.now()}`;
    newSnapshot.observation_run_id = verifyRunId;

    // Compute diff vs previous
    let diff: PageSnapshotDiff | null = null;
    if (prevSnapshot) {
      diff = diffSnapshots(newSnapshot, prevSnapshot);
    }

    // Load citation count for guardrail context
    let citationCount = 0;
    try {
      const ciPath = join(DATA_DIR, "citation-evidence-index.json");
      if (existsSync(ciPath)) {
        const ci = JSON.parse(readFileSync(ciPath, "utf8"));
        const normUrl = url.replace(/\/+$/, "").toLowerCase();
        for (const r of ci.by_page_and_topic ?? []) {
          if (r.is_owned && r.page_url.replace(/\/+$/, "").toLowerCase() === normUrl) {
            citationCount += r.total_citations;
          }
        }
      }
    } catch {}

    // Classify new guardrails
    const rawAlerts = classifyGuardrails(newSnapshot, diff, citationCount);
    const newAlerts = rawAlerts.map((a) => ({
      ...a,
      observation_run_id: verifyRunId,
    }));

    // Determine what cleared vs what remains
    const prevCategories = new Set(prevAlerts.map((a) => a.category));
    const newCategories = new Set(newAlerts.map((a) => a.category));

    const cleared = [...prevCategories].filter((c) => !newCategories.has(c));
    const remaining = [...newCategories];

    const nowIso = new Date().toISOString();
    const buckets = countGuardrailBuckets(newAlerts);
    const verifyRun: ObservationRun = {
      run_id: verifyRunId,
      run_type: "website_verify",
      source: "verify-action.ts (ship verification fetch)",
      status: "completed",
      started_at: nowIso,
      completed_at: nowIso,
      scope_label: `Single URL verification fetch: ${url}`,
      parser_version: OBSERVATION_RUN_PARSER_VERSION,
      baseline_run_id: baselineRunId,
      pages_scanned: 1,
      pages_changed: diff?.changed ? 1 : 0,
      pages_with_errors: newSnapshot.http_status !== 200 ? 1 : 0,
      ...buckets,
      ...universeFieldsForObservationPersistence(),
    };
    appendObservationRunSync(verifyRun);

    // Update snapshots file — replace this page's snapshot
    const updatedSnapshots = allSnapshots.filter(
      (s) => s.url.replace(/\/+$/, "").toLowerCase() !== url.replace(/\/+$/, "").toLowerCase()
    );
    updatedSnapshots.push(newSnapshot);
    const snapTmp = snapPath + ".tmp";
    writeFileSync(snapTmp, JSON.stringify(updatedSnapshots, null, 2), "utf8");
    renameSync(snapTmp, snapPath);

    // Update guardrails — replace this page's alerts
    if (existsSync(gPath)) {
      const allAlerts = JSON.parse(readFileSync(gPath, "utf8")) as GuardrailAlert[];
      const otherAlerts = allAlerts.filter(
        (a) => a.url.replace(/\/+$/, "").toLowerCase() !== url.replace(/\/+$/, "").toLowerCase()
      );
      const updated = [...otherAlerts, ...newAlerts];
      const gTmp = gPath + ".tmp";
      writeFileSync(gTmp, JSON.stringify(updated, null, 2), "utf8");
      renameSync(gTmp, gPath);
    }

    revalidatePath("/", "layout");

    return {
      success: true,
      url,
      previousAlertCount: prevAlerts.length,
      currentAlertCount: newAlerts.length,
      cleared,
      remaining,
      diff: diff
        ? { changed: diff.changed, summary: diff.summary }
        : null,
      verificationObservationRunId: verifyRunId,
      verificationBaselineObservationRunId: baselineRunId,
    };
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
