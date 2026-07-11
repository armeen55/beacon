import "server-only";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import { loadProvenWins } from "@/domains/attribution/load-proven-wins";
import { splitLedgerLifecycle } from "@/domains/changes/lifecycle-counts";
import { verdictSchedule } from "@/domains/proof-gsc/verdict-schedule";
import { monthDayLabel } from "@/components/data/receipt-line";
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
  // Wave 3A: measuring is the canonical lifecycle set and the next-read date is the one
  // verdictSchedule - never a raw stored-verdict filter or a bespoke checkOn walk -
  // so Today's measuring strip agrees with Results and the scoreboard. UTC monthDayLabel.
  const now = new Date();
  const measuring = splitLedgerLifecycle(records, now).measuring;
  if (measuring.length === 0) return null;

  const nextCheckDate = monthDayLabel(verdictSchedule(measuring, now).firstReadOn);

  const recent: MeasuringExperiment[] = measuring
    .slice(0, 3)
    .map((r) => ({ path: r.path, actionType: r.actionType }));

  return <TodayV2ExperimentsMeasuring count={measuring.length} nextCheckDate={nextCheckDate} recent={recent} />;
}

export async function TodayV2ProvenResultsSection() {
  const wins = await loadProvenWins({ limit: 4 }).catch(() => []);
  return <TodayV2ProvenResults wins={wins} />;
}
