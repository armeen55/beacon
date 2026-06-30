import "server-only";

/**
 * daily-experiments-data (2026-06-30) — server loader for the native Daily Experiments section.
 * READ-ONLY + fail-soft + NO candidate planning on render (planning happens only on the explicit
 * "Plan today's experiments" action). Reads the active proof batch (always available), plus any
 * persisted preview/accepted plan + active reservations (fail-soft if the table layer is briefly
 * unavailable). Shapes everything through the pure dashboard read model.
 */
import { currentTenantId } from "@/lib/tenant-context";
import { loadProofLedger } from "@/domains/proof-gsc/load-ledger";
import { buildDailyExperimentDashboard, protectedControlWarning, type DailyExperimentDashboard } from "@/domains/experiments/daily-experiment-dashboard";
import { getLatestPreviewPlan, getAcceptedPlan, listActiveReservations } from "@/domains/experiments/daily-experiment-plan-store";

export type DailyExperimentsView = { dashboard: DailyExperimentDashboard; protectedWarning: string | null };

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
  return { dashboard, protectedWarning: protectedControlWarning(dashboard) };
}
