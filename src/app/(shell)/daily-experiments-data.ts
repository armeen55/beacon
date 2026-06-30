import "server-only";

/**
 * daily-experiments-data (2026-06-30 → 2026-07-01) — server loader for the native Daily Experiments
 * section. READ-ONLY + fail-soft + NO candidate planning / NO verification on render. Reads the active
 * proof batch (always available), any persisted preview/accepted plan + reservations, and — when a
 * plan is accepted — builds the per-item execution checklist. Shapes everything through pure models.
 */
import { currentTenantId } from "@/lib/tenant-context";
import { loadProofLedger } from "@/domains/proof-gsc/load-ledger";
import { buildDailyExperimentDashboard, protectedControlWarning, type DailyExperimentDashboard } from "@/domains/experiments/daily-experiment-dashboard";
import { buildExecutionChecklist, type ExecutionChecklist } from "@/domains/experiments/execution-checklist";
import { getLatestPreviewPlan, getAcceptedPlan, listActiveReservations, listReservationsForPlan } from "@/domains/experiments/daily-experiment-plan-store";

export type DailyExperimentsView = {
  dashboard: DailyExperimentDashboard;
  protectedWarning: string | null;
  checklist: ExecutionChecklist | null;
};

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

  return { dashboard, protectedWarning: protectedControlWarning(dashboard), checklist };
}
