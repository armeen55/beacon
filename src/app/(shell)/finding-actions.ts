"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { updateFindingStatus } from "@/domains/scanning/findings-store";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
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
  // Phase post-A+B1 (2026-04-21) — new heading / schema-name finding types.
  h2_changed: "content",
  h3_changed: "content",
  schema_entity_names_changed: "technical",
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
  // Phase post-A+B1 (2026-04-21) — new heading / schema-name edit hypotheses.
  h2_changed:
    "H2 rewrite — sharpening a section heading so AI retrieval can locate the relevant content block.",
  h3_changed:
    "H3 rewrite — improving sub-section signposting for topical retrieval.",
  schema_entity_names_changed:
    "Schema entity-name update — refining the semantic labels on Service / Offer / Breadcrumb entities so AI engines can match them to user intent.",
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

  // Phase C-follow-up (2026-04-24): read the finding fresh from the
  // repository. The old `getFindings()` path pulled from an in-memory
  // cache that's empty on Vercel cold start, so every Confirm click on
  // hosted silently failed here before even reaching updateFindingStatus.
  // Sprint 7 Phase 7.5b Commit 5 (2026-04-25) — tenant-bound read.
  const tenantId = await currentTenantId();
  const repoFindings = await getRepository()
    .forTenant(tenantId)
    .getScanFindings();
  const finding = repoFindings.find((f) => f.id === findingId);
  if (!finding) {
    log.error("Action failed", { action, durationMs: Date.now() - t0, error: "finding not found" });
    return { success: false };
  }

  // 1. Accept the finding and promote to changelog
  await updateFindingStatus(findingId, "accepted", { promotionStatus: "changelog" });

  // 2. Create a changelog entry from the finding
  const changeId = generateId("cl");
  // Phase 3.5I-trust (2026-04-22): use the scanner's `detectedAt` for the
  // changelog `timestamp` (when the page actually changed, per HTML diff),
  // not `now()` (when the operator clicked Confirm). This keeps /changes
  // date-accurate for attribution. `created_at` below stays `now()` so the
  // audit trail for "when it was confirmed" is preserved.
  const timestamp = finding.detectedAt ?? now();
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
    // Fix 2 (2026-04-21) — when the finding auto-linked to an accepted rec,
    // the hypothesis semantically came from that rec, not just the edit-type
    // classifier. Upgrade source accordingly.
    hypothesis_source: finding.source_rec_id
      ? "recommendation"
      : inferredHypothesis
        ? "inferred"
        : undefined,
    expected_impact_window: "7-14 days",
    brief_id: null,
    opportunity_id: null,
    notes: `Auto-detected by scan. ${finding.previousState ? `Previous: "${finding.previousState}"` : ""} ${finding.currentState ? `Current: "${finding.currentState}"` : ""}`.trim(),
    created_at: timestamp,
    updated_at: timestamp,
    source_system: "scan_detection",
    // Fix 2 (2026-04-21) — carry the auto-linked rec/pattern IDs from the
    // finding into the changelog entry so per-rec and per-pattern attribution
    // becomes ground truth. Null when the finding had no recent accepted rec
    // on this URL (legitimate case: operator change without a Beacon rec).
    source_rec_id: finding.source_rec_id,
    source_pattern_id: finding.source_pattern_id ?? null,
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
  await syncChangelogEntries([entry], tenantId);

  // 4. Link the finding to the new changelog entry
  await updateFindingStatus(findingId, "accepted", {
    promotionStatus: "changelog",
    linkedChangeId: changeId,
  });

  // Phase 4 (2026-04-19): auto-experiment creation removed. The Z-score engine
  // in url-change-outcomes watches every URL change automatically via
  // url-watcher \u2014 no separate tracking table needed.

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0, changeId });
  return { success: true, changeId };
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
