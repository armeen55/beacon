import "server-only";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import { loadProvenWins } from "@/domains/attribution/load-proven-wins";
import {
  TodayV2ExperimentsMeasuring,
  type MeasuringExperiment,
} from "@/components/today/v2/today-v2-experiments-measuring";
import { TodayV2ProvenResults } from "@/components/today/v2/today-v2-proven-results";

/**
 * Today proof sections (2026-06-27) — the two proof/learning sections the
 * ActionPack cockpit keeps from the old today-v2 layer: "what's measuring"
 * (proof ledger) and "proven results" (causal wins). The rest of today-v2-sections
 * (visibility-score group, descriptors, action-cards, edit-lifecycle, etc.) was
 * deleted with the lens museum. Operator-gated where noted; self-hide when empty.
 */
export async function TodayV2ExperimentsMeasuringSection() {
  if (!isOperatorModeServer()) return null;
  const tenantId = await currentTenantId().catch(() => null);
  if (!tenantId) return null;
  // P0-B W1: render path serves the persisted/snapshot ledger (no re-measure on GET).
  const records = await loadProofLedgerCached(tenantId).catch(() => []);
  const measuring = records.filter((r) => r.verdict === "measuring");
  if (measuring.length === 0) return null;

  const todayYmd = new Date().toISOString().slice(0, 10);
  let nextCheckDate: string | null = null;
  for (const r of measuring) {
    for (const w of r.windows) {
      if (w.ran || !w.checkOn || w.checkOn <= todayYmd) continue;
      if (nextCheckDate == null || w.checkOn < nextCheckDate) nextCheckDate = w.checkOn;
    }
  }

  const recent: MeasuringExperiment[] = measuring
    .slice(0, 3)
    .map((r) => ({ path: r.path, actionType: r.actionType }));

  return <TodayV2ExperimentsMeasuring count={measuring.length} nextCheckDate={nextCheckDate} recent={recent} />;
}

export async function TodayV2ProvenResultsSection() {
  const wins = await loadProvenWins({ limit: 4 }).catch(() => []);
  return <TodayV2ProvenResults wins={wins} />;
}
