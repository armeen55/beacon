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

export type QualitySummary = { total: number; passed: number; cautioned: number; flagged: number };

export type DailyExperimentsView = {
  dashboard: DailyExperimentDashboard;
  protectedWarning: string | null;
  checklist: ExecutionChecklist | null;
  /** Move 4 - the deterministic quality review of the active plan's selected items. */
  qualitySummary: QualitySummary | null;
  /** Item 4: 70-day daily clicks per plan-item URL (sparkline next to each page name). */
  sparklineByUrl: Record<string, Array<{ date: string; clicks: number }>>;
};

/** Re-run the quality gate over the active plan's items so the panel can honestly say
 *  "all passed quality checks" (and surface any caution). PURE over the plan record. */
function summarizeQuality(items: PlannedExperimentRecord[]): QualitySummary {
  let passed = 0, cautioned = 0, flagged = 0;
  for (const e of items) {
    const r = reviewRecommendation({
      lever: e.lever, pagePath: normalizePath(e.url), pageLabel: e.pageLabel, targetQuery: e.targetQuery,
      currentText: e.currentText, proposedText: e.proposedText, controlsAvailable: e.controls.length,
      sourceSentences: e.lever === "answer_block" ? [e.proposedText] : undefined,
    });
    if (r.decision === "approved") passed += 1;
    else if (r.decision === "approved_with_caution") { passed += 1; cautioned += 1; }
    else flagged += 1;
  }
  return { total: items.length, passed, cautioned, flagged };
}

export async function loadDailyExperimentsView(): Promise<DailyExperimentsView> {
  const tenantId = await currentTenantId();
  const now = new Date();
  const [ledger, previewPlan, acceptedPlan, reservations] = await Promise.all([
    loadProofLedger(tenantId).catch(() => []),
    getLatestPreviewPlan(tenantId),
    getAcceptedPlan(tenantId),
    listActiveReservations(tenantId),
  ]);
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

  return { dashboard, protectedWarning: protectedControlWarning(dashboard), checklist, qualitySummary, sparklineByUrl };
}
