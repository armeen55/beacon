"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
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
import {
  syncPageSnapshots,
  syncGuardrailAlertsForUrl,
} from "@/lib/persistence/dual-write";
import { getRepository } from "@/lib/persistence/repositories";
import { persistPageElements } from "@/domains/pages/extractors/persist";
import { getBusinessConfig } from "@/lib/business-config";
import { currentTenantId } from "@/lib/tenant-context";

const DATA_DIR = join(process.cwd(), ".data");
const IS_VERCEL = process.env.VERCEL === "1";

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
  const action = "verifyPageFix";
  const t0 = Date.now();
  log.info("Action started", { action, params: { urlLength: url.length } });
  // Phase 7.7b Commit 3 (2026-04-25): hoist tenantId once for the whole
  // action and thread to syncPageSnapshots / syncGuardrailAlertsForUrl
  // / persistPageElements below. Earlier sites that called
  // `await currentTenantId()` inline now reuse this local.
  const tenantId = await currentTenantId();
  const base: VerifyResult = {
    success: false,
    url,
    previousAlertCount: 0,
    currentAlertCount: 0,
    cleared: [],
    remaining: [],
    diff: null,
  };

  const normUrl = url.replace(/\/+$/, "").toLowerCase();
  const gPath = join(DATA_DIR, "page-guardrails.json");
  const snapPath = join(DATA_DIR, "page-snapshots.json");

  try {
    // Load previous alerts for this URL.
    // Phase 4.5: on Vercel .data is read-only; source from Supabase via
    // the repository instead. On local dev, keep the FS read.
    let prevAlerts: GuardrailAlert[] = [];
    if (IS_VERCEL) {
      // Sprint 7 Phase 7.5b Commit 5 (2026-04-25) — tenant-bound read.
      const allDbAlerts = await getRepository()
        .forTenant(tenantId)
        .getGuardrailAlerts();
      prevAlerts = allDbAlerts.filter(
        (a) => a.url.replace(/\/+$/, "").toLowerCase() === normUrl,
      );
    } else if (existsSync(gPath)) {
      const all = JSON.parse(readFileSync(gPath, "utf8")) as GuardrailAlert[];
      prevAlerts = all.filter(
        (a) => a.url.replace(/\/+$/, "").toLowerCase() === normUrl,
      );
    }
    base.previousAlertCount = prevAlerts.length;

    // Load previous snapshot.
    // Phase 4.5: Vercel → Supabase via repo; local → FS as before.
    // `allSnapshots` is retained in the local-dev branch so the FS
    // replace-dance below still works; on Vercel we don't need it since
    // Supabase upsert handles per-snapshot replacement directly.
    let prevSnapshot: PageSnapshot | null = null;
    let allSnapshots: PageSnapshot[] = [];
    if (IS_VERCEL) {
      // Sprint 7 Phase 7.5b Commit 5 (2026-04-25) — tenant-bound read.
      const allDbSnapshots = await getRepository()
        .forTenant(tenantId)
        .getPageSnapshots();
      // Pick the most recent snapshot for this URL (repo returns all).
      const matches = allDbSnapshots
        .filter(
          (s) => s.url.replace(/\/+$/, "").toLowerCase() === normUrl,
        )
        .sort(
          (a, b) =>
            new Date(b.fetched_at).getTime() -
            new Date(a.fetched_at).getTime(),
        );
      prevSnapshot = matches[0] ?? null;
    } else if (existsSync(snapPath)) {
      allSnapshots = JSON.parse(readFileSync(snapPath, "utf8")) as PageSnapshot[];
      prevSnapshot = allSnapshots.find(
        (s) => s.url.replace(/\/+$/, "").toLowerCase() === normUrl,
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
      tenant_id: "",
    };
    // Phase 4.5: appendObservationRunSync now internally gates its FS write
    // on Vercel while always running the Supabase dual-write. Safe to call
    // in both environments.
    appendObservationRunSync(verifyRun);

    // Update snapshots. Phase 4.5: Vercel skips FS; local keeps FS
    // (replace-dance against `allSnapshots`). Both paths call
    // `syncPageSnapshots([newSnapshot])` to upsert on `id` — idempotent
    // regardless of environment.
    if (!IS_VERCEL) {
      const updatedSnapshots = allSnapshots.filter(
        (s) => s.url.replace(/\/+$/, "").toLowerCase() !== normUrl,
      );
      updatedSnapshots.push(newSnapshot);
      const snapTmp = snapPath + ".tmp";
      writeFileSync(snapTmp, JSON.stringify(updatedSnapshots, null, 2), "utf8");
      renameSync(snapTmp, snapPath);
    }
    await syncPageSnapshots([newSnapshot], tenantId);

    // Sprint 6A.1 Phase 6 — extract + dual-write the inventory rows for
    // this snapshot. Runs AFTER `syncPageSnapshots` so the snapshot is
    // already durable; `persistPageElements` swallows any extractor or
    // dual-write failure internally so it cannot regress verify success.
    try {
      const cfg = getBusinessConfig();
      await persistPageElements({
        snapshot: newSnapshot,
        html,
        tenantId,
        cityDictionary: cfg.locations,
        serviceDictionary: cfg.services,
      });
    } catch (e) {
      log.warn("verifyPageFix: page element persistence failed (non-fatal)", {
        url,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Update guardrails for THIS URL only. Phase 4.5:
    //   - On local: FS replace-dance AND URL-scoped Supabase sync
    //   - On Vercel: Supabase URL-scoped sync only
    // The new helper `syncGuardrailAlertsForUrl` deletes only rows whose
    // `url = this URL` before inserting the fresh alert set. Other URLs'
    // alerts are untouched — unlike the global `syncGuardrailAlerts`
    // (delete-replace everything) used by orchestrate-scan.
    if (!IS_VERCEL && existsSync(gPath)) {
      const allAlerts = JSON.parse(readFileSync(gPath, "utf8")) as GuardrailAlert[];
      const otherAlerts = allAlerts.filter(
        (a) => a.url.replace(/\/+$/, "").toLowerCase() !== normUrl,
      );
      const updated = [...otherAlerts, ...newAlerts];
      const gTmp = gPath + ".tmp";
      writeFileSync(gTmp, JSON.stringify(updated, null, 2), "utf8");
      renameSync(gTmp, gPath);
    }
    await syncGuardrailAlertsForUrl(url, newAlerts, tenantId);

    revalidatePath("/", "layout");

    log.info("Action completed", { action, durationMs: Date.now() - t0 });
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
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: msg.slice(0, 500),
    });
    return {
      ...base,
      error: msg,
    };
  }
}
