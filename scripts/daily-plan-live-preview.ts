/**
 * Daily-plan LIVE preview (Phase 14/15) — persists the REAL Iranopedia preview through the production
 * Supabase repository, reads it back, asserts ZERO reservations (preview ≠ accept), then runs
 * acceptance VALIDATION-ONLY against the current topology. Does NOT call the accept RPC (no
 * reservations, no proof rows, no Wix). Leaves the Accept button ready for the operator.
 *   set -a; . ./.env.local; set +a
 *   BEACON_TENANT_ID=tenant-iranopedia npx tsx --require ./scripts/mock-server-only.cjs scripts/daily-plan-live-preview.ts
 */
import { buildTodayExperimentPreview } from "@/domains/experiments/build-today-preview";
import { createPreviewPlan, getLatestPreviewPlan, listActiveReservations, expirePlans } from "@/domains/experiments/daily-experiment-plan-store";
import { loadProofLedger } from "@/domains/proof-gsc/load-ledger";
import { deriveExperimentStates } from "@/domains/experiments/experiment-eligibility";
import { validatePlanAcceptance, type AcceptanceContext } from "@/domains/experiments/validate-plan-acceptance";
import { normalizePath } from "@/domains/experiments/daily-plan-types";

const TENANT = process.env.BEACON_TENANT_ID ?? "tenant-iranopedia";

async function main() {
  const now = new Date();
  await expirePlans(TENANT, now).catch(() => 0);

  const { record, candidatesEvaluated, excludedByReason } = await buildTodayExperimentPreview(TENANT, now);
  const dist = record.distribution.byLever;
  const controls = record.selected.reduce((n, e) => n + e.controls.length, 0);
  console.log(`[build] ${record.id}`);
  console.log(`  selected=${record.selected.length} backups=${record.backups.length} candidatesEvaluated=${candidatesEvaluated}`);
  console.log(`  byLever=${JSON.stringify(dist)} estMin=${record.estimatedMinutes} controls=${controls}`);
  console.log(`  snapshot: treated=${record.activeExperimentSnapshot.treatedUrls.length} control=${record.activeExperimentSnapshot.controlUrls.length}`);
  console.log(`  excludedByReason=${JSON.stringify(excludedByReason)}`);
  console.log(`  selected pages: ${record.selected.map((e) => `${e.lever}:${e.pageLabel}`).join(", ")}`);

  // Persist the real preview (fail-closed).
  await createPreviewPlan(record);
  const back = await getLatestPreviewPlan(TENANT);
  console.log(`[persist] readback id=${back?.id} status=${back?.status} match=${back?.id === record.id}`);

  // Preview must hold ZERO reservations.
  const reservations = await listActiveReservations(TENANT);
  console.log(`[reservations] active=${reservations.length} (expect 0 for a preview)`);

  // Phase 15 — acceptance VALIDATION-ONLY (no RPC).
  if (!back) throw new Error("readback failed");
  const ledger = await loadProofLedger(TENANT).catch(() => []);
  const states = deriveExperimentStates(ledger, now);
  const activeTreatedPaths = new Set<string>();
  const activeControlPaths = new Set<string>();
  for (const [p, st] of states) {
    if (st.activeTreatments.length) activeTreatedPaths.add(normalizePath(p));
    if (st.activeControlAssignments.length) activeControlPaths.add(normalizePath(p));
  }
  const reservedControlPaths = new Map<string, string>();
  for (const r of reservations) reservedControlPaths.set(normalizePath(r.controlPath), r.planId);
  const ctx: AcceptanceContext = { tenantId: TENANT, now, expectedInputHash: record.inputHash, activeTreatedPaths, activeControlPaths, reservedControlPaths };
  const v = validatePlanAcceptance(back, ctx);
  const wouldReserve = back.selected.reduce((n, e) => n + e.controls.length, 0);
  if (v.ok) {
    console.log(`[validate-only] ok=true wouldReserve=${wouldReserve}`);
  } else {
    console.log(`[validate-only] ok=false planLevelReason=${v.planLevelReason ?? "—"} failures=${v.failures?.length ?? 0} wouldReserve=${wouldReserve}`);
    if (v.failures?.length) console.log(`  failures: ${v.failures.map((f) => `${f.url}:${f.reason}`).join("; ")}`);
  }
  console.log(`[done] preview persisted + rendered-ready; Accept NOT executed (operator-gated).`);
}

main().catch((e) => { console.error("LIVE PREVIEW FAILED:", e); process.exit(1); });
