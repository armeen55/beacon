import "server-only";

/**
 * daily-experiments-data (2026-06-30 → 2026-07-01) - server loader for the native Daily Experiments
 * section. READ-ONLY + fail-soft + NO candidate planning / NO verification on render. Reads the active
 * proof batch (always available), any persisted preview/accepted plan + reservations, and - when a
 * plan is accepted - builds the per-item execution checklist. Shapes everything through pure models.
 */
import { currentTenantId } from "@/lib/tenant-context";
import { loadDailyClicksByPagesForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { loadProofLedger } from "@/domains/proof-gsc/load-ledger";
import { buildDailyExperimentDashboard, protectedControlWarning, type DailyExperimentDashboard } from "@/domains/experiments/daily-experiment-dashboard";
import { buildExecutionChecklist, type ExecutionChecklist } from "@/domains/experiments/execution-checklist";
import { getLatestPreviewPlan, getAcceptedPlan, listActiveReservations, listReservationsForPlan } from "@/domains/experiments/daily-experiment-plan-store";
import { normalizePath, type PlannedExperimentRecord } from "@/domains/experiments/daily-plan-types";
import { reviewRecommendation } from "@/domains/recommendations/recommendation-quality";
import { getStagingAvailability } from "@/domains/push/stage-change";
import { STAGING_OFF, type StagingAvailability } from "@/domains/push/stage-route";
import { getWixUrlMap } from "@/lib/connectors/wix/url-map";
import { getWixConnectorToken } from "@/lib/connector-store";
import { buildWixEditorLink } from "@/domains/push/wix-deep-link";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
// R14b (receipts everywhere) - the plan panel's one-line receipt, built HERE
// (server) so the client section renders a hydration-stable string.
import { buildReceiptLine } from "@/components/data/receipt-line";

export type QualitySummary = { total: number; passed: number; cautioned: number; flagged: number; paused: number };

export type DailyExperimentsView = {
  dashboard: DailyExperimentDashboard;
  protectedWarning: string | null;
  checklist: ExecutionChecklist | null;
  /** Move 4 - the deterministic quality review of the active plan's selected items. */
  qualitySummary: QualitySummary | null;
  /** Item 4: 70-day daily clicks per plan-item URL (sparkline next to each page name). */
  sparklineByUrl: Record<string, Array<{ date: string; clicks: number }>>;
  /** Item 15 - can the operator one-click "Stage in Wix" (armed + permitted + live Wix
   *  target)? Fails to OFF on any uncertainty; the card then keeps today's paste-only
   *  behavior exactly. */
  staging: StagingAvailability;
  /** Item 45 - "Open in Wix" deep link per plan-item URL (canonical url -> dashboard
   *  URL, or absent when the page is not resolvable to a live Wix item yet). */
  wixEditorUrlByUrl: Record<string, string>;
  /** R14b (receipts everywhere) - when the active plan was put together and from
   *  what source. Null when no plan exists. */
  planReceiptLine: string | null;
};

/** Re-run the quality gate over the active plan's items so the panel can honestly say
 *  "all passed quality checks" (and surface any caution). PURE over the plan record.
 *  N9: this gate is re-run WITHOUT fresh `sourceEvidence` (the plan-item record doesn't
 *  carry cross-source signals), so an item already selected here practically never comes
 *  back paused - it would have been excluded at selection time in build-today-preview.ts
 *  when the evidence was available. The `paused` bucket exists so the UI's self-hiding
 *  group has somewhere honest to render if a future caller does thread evidence through. */
function summarizeQuality(items: PlannedExperimentRecord[]): QualitySummary {
  let passed = 0, cautioned = 0, flagged = 0, paused = 0;
  for (const e of items) {
    const r = reviewRecommendation({
      lever: e.lever, pagePath: normalizePath(e.url), pageLabel: e.pageLabel, targetQuery: e.targetQuery,
      currentText: e.currentText, proposedText: e.proposedText, controlsAvailable: e.controls.length,
      sourceSentences: e.lever === "answer_block" ? [e.proposedText] : undefined,
    });
    if (r.decision === "approved") passed += 1;
    else if (r.decision === "approved_with_caution") { passed += 1; cautioned += 1; }
    else if (r.decision === "paused_source_contradiction") paused += 1;
    else flagged += 1;
  }
  return { total: items.length, passed, cautioned, flagged, paused };
}

export async function loadDailyExperimentsView(): Promise<DailyExperimentsView> {
  const tenantId = await currentTenantId();
  const now = new Date();
  const [ledger, previewPlan, acceptedPlan, reservations, staging, wixUrlMap, wixToken] = await Promise.all([
    loadProofLedger(tenantId).catch(() => []),
    getLatestPreviewPlan(tenantId),
    getAcceptedPlan(tenantId),
    listActiveReservations(tenantId),
    getStagingAvailability(tenantId).catch(() => STAGING_OFF),
    getWixUrlMap().catch(() => []),
    getWixConnectorToken(tenantId).catch(() => null),
  ]);
  // Item 45 - "Open in Wix": one url-map read (already fetched above) resolved
  // to a dashboard link per canonical URL. Missing/unmapped pages are simply
  // absent from the map, which the card reads as "no link" (never a dead one).
  const wixEntryByCanonUrl = new Map(
    wixUrlMap.map((e) => [(canonicalizeCitationUrl(e.url) ?? e.url).toLowerCase(), e]),
  );
  const wixEditorUrlByUrl: DailyExperimentsView["wixEditorUrlByUrl"] = {};
  const dashboard = buildDailyExperimentDashboard({
    ledger, now,
    previewPlan: previewPlan ?? undefined,
    acceptedPlan: acceptedPlan ?? undefined,
    reservations,
  });

  let checklist: ExecutionChecklist | null = null;
  if (acceptedPlan) {
    const planReservations = await listReservationsForPlan(tenantId, acceptedPlan.id).catch(() => []);
    checklist = buildExecutionChecklist(acceptedPlan, planReservations);
  }

  const activePlan = acceptedPlan ?? previewPlan;
  const qualitySummary = activePlan ? summarizeQuality(activePlan.selected) : null;

  // Item 4: one bounded per-page daily-clicks read (IN <= 16) so every card shows the
  // page's own trend line next to its name. Fail-soft -> empty (cards render as before).
  const planUrls = [...new Set((activePlan?.selected ?? []).map((e) => e.url))].slice(0, 16);
  const sparkMap = planUrls.length
    ? await loadDailyClicksByPagesForTenant(tenantId, planUrls).catch(() => new Map<string, { date: string; clicks: number }[]>())
    : new Map<string, { date: string; clicks: number }[]>();
  const sparklineByUrl: DailyExperimentsView["sparklineByUrl"] = {};
  for (const [url, series] of sparkMap) sparklineByUrl[url] = series;

  // Item 45 - resolve "Open in Wix" for every item actually on the active plan
  // (not the whole url-map). A pure resolve; honest null (absent key) when the
  // page has no site connected or no collection mapping yet.
  for (const exp of activePlan?.selected ?? []) {
    const rawUrl = exp.canonicalUrl || exp.url;
    const key = (canonicalizeCitationUrl(rawUrl) ?? rawUrl).toLowerCase();
    const entry = wixEntryByCanonUrl.get(key);
    if (!entry) continue;
    const link = buildWixEditorLink({
      siteId: wixToken?.site_id ?? null,
      dataCollectionId: entry.dataCollectionId,
      dataItemId: entry.dataItemId,
    });
    if (link) wixEditorUrlByUrl[exp.url] = link.toString();
  }

  // R14b (receipts everywhere) - the plan's own assembly stamp, in the shared
  // one-line receipt convention. Null (line self-hides) when no plan exists.
  const planReceiptLine = activePlan?.createdAt
    ? buildReceiptLine({
        source: "your latest Search Console read",
        checkedAt: activePlan.createdAt,
        verb: "put together",
        nowMs: now.getTime(),
      })
    : null;

  return { dashboard, protectedWarning: protectedControlWarning(dashboard), checklist, qualitySummary, sparklineByUrl, staging, wixEditorUrlByUrl, planReceiptLine };
}
