"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { getFindings, updateFindingStatus } from "@/domains/scanning/findings-store";
import { updateScanSettings } from "@/domains/scanning/scan-settings";
import type { ScanSettings, FindingStatus, PromotionStatus, FindingType } from "@/domains/scanning/types";
import { changelogEntries } from "@/lib/seed-data.server";
import { generateId, now } from "@/lib/actions";
import { writeStore } from "@/lib/persistence/json-store";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { SignalType } from "@/lib/constants";
import { syncChangelogEntries } from "@/lib/persistence/dual-write";
import { classifyAssetType } from "@/domains/pages/classify-asset-type";
import { deriveSchemaChangelogFields } from "@/domains/changelog/derive-schema-fields";
import {
  getPageSnapshots,
  getPreviousPageSnapshots,
} from "@/domains/pages/snapshot-store";

export async function resolveFinding(
  findingId: string,
  status: string,
  opts?: {
    resolutionNote?: string;
    suppressDays?: number;
  },
): Promise<{ success: boolean; consequence?: string }> {
  const action = "resolveFinding";
  const t0 = Date.now();
  log.info("Action started", { action, params: { findingId, status } });
  const validStatuses: FindingStatus[] = ["pending", "accepted", "rejected", "ignored", "expected"];
  if (!validStatuses.includes(status as FindingStatus)) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "invalid status",
    });
    return { success: false };
  }

  const suppressDays = status === "expected" ? (opts?.suppressDays ?? 14) : 0;

  const result = await updateFindingStatus(
    findingId,
    status as FindingStatus,
    {
      resolutionNote: opts?.resolutionNote ?? null,
      suppressDays,
    },
  );
  if (!result) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "updateFindingStatus returned false",
    });
    return { success: false };
  }

  let consequence = "";
  switch (status) {
    case "accepted":
      consequence = "Marked as trusted. You can promote this to the changelog or keep as a verified finding.";
      break;
    case "expected":
      consequence = `Suppressed for ${suppressDays} days. Similar findings on this page won't re-appear during that window.`;
      break;
    case "ignored":
      consequence = "Dismissed. This stays in history but won't affect recommendations.";
      break;
    case "rejected":
      consequence = "Marked as false positive. Future similar detections for this page will be de-prioritized.";
      break;
  }

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true, consequence };
}

export async function promoteFinding(
  findingId: string,
  promotionStatus: string,
): Promise<{ success: boolean }> {
  const action = "promoteFinding";
  const t0 = Date.now();
  log.info("Action started", { action, params: { findingId, promotionStatus } });
  const validPromotions: PromotionStatus[] = ["none", "changelog", "secondary_note", "history_only"];
  if (!validPromotions.includes(promotionStatus as PromotionStatus)) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "invalid promotionStatus",
    });
    return { success: false };
  }

  const result = await updateFindingStatus(findingId, "accepted", {
    promotionStatus: promotionStatus as PromotionStatus,
  });
  if (!result) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "updateFindingStatus returned false",
    });
    return { success: false };
  }
  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

// ---------------------------------------------------------------------------
// Confirm a scan finding as a real change → auto-create changelog entry
// ---------------------------------------------------------------------------

const FINDING_TO_SIGNAL: Partial<Record<FindingType, SignalType>> = {
  title_changed: "content",
  meta_changed: "content",
  h1_changed: "content",
  faq_changed: "faq",
  schema_changed: "technical",
  content_changed: "content",
  canonical_changed: "technical",
  links_changed: "technical",
  page_added: "page",
  page_removed: "page",
  // Phase 1 — confirming a schema-parity finding produces a technical-signal changelog row.
  schema_missing_for_page_type: "technical",
};

/**
 * Default hypothesis inferred from the edit type when the user confirms a scan finding.
 * The operator can always overwrite this on the /changes/[id] detail page.
 */
const FINDING_HYPOTHESIS: Partial<Record<FindingType, string>> = {
  title_changed:
    "Title rewrite — repositioning the page for a different keyword variant. Expect citation lift if the new title better matches AI search queries.",
  meta_changed:
    "Meta description rewrite — aiming to improve CTR from search and AI-answer extractability.",
  h1_changed:
    "H1 rewrite — clarifying the page's primary topic for crawlers and AI answer engines.",
  faq_changed:
    "FAQ update — expanding the question coverage for answer-engine retrieval.",
  schema_changed:
    "Schema change — improving structured-data coverage so AI engines can lift facts more reliably.",
  content_changed:
    "Content edit — refreshing on-page copy to better match current answer-engine prompts.",
  canonical_changed:
    "Canonical change — redirecting crawl/citation credit to the preferred URL.",
  links_changed:
    "Internal link change — redistributing authority to priority pages.",
  page_added:
    "New page — filling a known content gap. Expect first citations when engines recrawl and retrieve the page.",
  page_removed:
    "Page removed — cleaning up low-signal pages or consolidating into stronger ones.",
  faq_without_schema:
    "Added FAQ schema to existing FAQ content — making Q&A blocks machine-readable for AI engines.",
  schema_missing_for_page_type:
    "Page-scoped schema parity — adding the structured-data types that peer pages of the same asset_type already carry. Tests whether schema coverage moves AI citations on this URL.",
};

export async function confirmFindingAsChange(
  findingId: string,
): Promise<{ success: boolean; changeId?: string }> {
  const action = "confirmFindingAsChange";
  const t0 = Date.now();
  log.info("Action started", { action, params: { findingId } });

  const findings = getFindings();
  const finding = findings.find((f) => f.id === findingId);
  if (!finding) {
    log.error("Action failed", { action, durationMs: Date.now() - t0, error: "finding not found" });
    return { success: false };
  }

  // 1. Accept the finding and promote to changelog
  await updateFindingStatus(findingId, "accepted", { promotionStatus: "changelog" });

  // 2. Create a changelog entry from the finding
  const changeId = generateId("cl");
  const timestamp = now();
  const signalType: SignalType = FINDING_TO_SIGNAL[finding.type] ?? "content";
  const assetType = classifyAssetType(finding.url);
  const pagePath = finding.pagePath || (finding.url ? finding.url.replace(/^https?:\/\/[^/]+/, "") : "") || "/";

  const inferredHypothesis = FINDING_HYPOTHESIS[finding.type] ?? null;

  const entry: ChangelogEntry = {
    id: changeId,
    timestamp,
    signal_type: signalType,
    asset_type: assetType,
    url: finding.url,
    asset_name: pagePath,
    change_description: finding.summary,
    topic_targeted: "",
    city_targeted: null,
    hypothesis: inferredHypothesis,
    hypothesis_source: inferredHypothesis ? "inferred" : undefined,
    expected_impact_window: "7-14 days",
    brief_id: null,
    opportunity_id: null,
    notes: `Auto-detected by scan. ${finding.previousState ? `Previous: "${finding.previousState}"` : ""} ${finding.currentState ? `Current: "${finding.currentState}"` : ""}`.trim(),
    created_at: timestamp,
    updated_at: timestamp,
    source_system: "scan_detection",
    tenant_id: "",
  };

  // Phase 1 — stamp structured schema-experiment fields when the finding
  // is a schema-class signal. Only runs for schema_changed /
  // schema_missing_for_page_type / faq_without_schema confirmations; other
  // finding types leave the entry unchanged (legacy free-text match path).
  //
  // When prev/current snapshots show the schema changed, the derived
  // fields go onto the entry so downstream attribution can match via
  // schema_types_added instead of free-text `change_description`.
  const schemaFindingTypes: ReadonlySet<string> = new Set([
    "schema_changed",
    "schema_missing_for_page_type",
    "faq_without_schema",
  ]);
  if (finding.url && schemaFindingTypes.has(finding.type)) {
    const normTarget = finding.url
      .replace(/^https?:\/\/[^/]+/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
    const matchesUrl = (s: { url: string }) =>
      s.url.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "").toLowerCase() ===
      normTarget;
    const cur = getPageSnapshots().find(matchesUrl) ?? null;
    const prev = getPreviousPageSnapshots().find(matchesUrl) ?? null;
    if (cur) {
      const derived = deriveSchemaChangelogFields({
        currentSnapshot: cur,
        previousSnapshot: prev,
      });
      if (derived) Object.assign(entry, derived);
    }
  }

  // 3. Persist: add to in-memory array + write to disk + Supabase
  changelogEntries.push(entry);
  await writeStore("imported-changes", changelogEntries);
  await syncChangelogEntries([entry]);

  // 4. Link the finding to the new changelog entry
  await updateFindingStatus(findingId, "accepted", {
    promotionStatus: "changelog",
    linkedChangeId: changeId,
  });

  // 5. Auto-create experiment to track this change's impact
  try {
    const { startExperiment, persistExperiments } = await import(
      "@/domains/product/experiment-store"
    );
    const baseline = await lookupBaselineMetricsForFinding(finding.url, signalType);
    startExperiment({
      recId: changeId,
      headline: entry.asset_name,
      recType: `scan_${signalType}`,
      targetPageUrl: finding.url,
      targetPagePath: pagePath,
      watchAfter: "Check after 7 days",
      operatorNote: finding.summary,
      baselineCitations: baseline.citations,
      baselineMentions: baseline.mentions,
      baselineVisibility: baseline.visibility,
      trackedTopic: entry.topic_targeted || null,
    });
    await persistExperiments();
  } catch (e) {
    console.warn("[auto-experiment] creation failed:", e);
  }

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0, changeId });
  return { success: true, changeId };
}

async function lookupBaselineMetricsForFinding(
  url: string,
  _signalType: string,
): Promise<{ citations: number; mentions: number; visibility: number }> {
  try {
    const { citationEvidenceIndex } = await import(
      "@/domains/pages/citation-evidence-store"
    );
    let citations = 0;
    if (citationEvidenceIndex && url) {
      const normPath = url.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "").toLowerCase();
      for (const r of citationEvidenceIndex.by_page_and_topic) {
        if (!r.is_owned) continue;
        const rPath = r.page_url.replace(/\/+$/, "").toLowerCase().replace(/^https?:\/\/[^/]+/, "");
        if (rPath === normPath) citations += r.total_citations;
      }
    }
    return { citations, mentions: 0, visibility: 0 };
  } catch {
    return { citations: 0, mentions: 0, visibility: 0 };
  }
}

export async function saveScanSettings(
  patch: Partial<ScanSettings>,
): Promise<{ success: boolean }> {
  const action = "saveScanSettings";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: { keys: Object.keys(patch) },
  });
  await updateScanSettings(patch);
  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}
