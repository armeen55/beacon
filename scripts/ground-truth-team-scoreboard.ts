/**
 * Ground-truth the specialist scoreboard (BEACON_500 item 38) against REAL Iranopedia data.
 *
 * Read-only report: how many ledger rows are settled (mature, unquarantined) today, how many
 * join to a plan pick that carries a team review, and what the resulting Brier scoreboard says.
 * Runs the real buildTeamScoreboardSummary, which persists its recompute to the real
 * team-scoreboard store (idempotent, same posture as harvestWinners/ground-truth-winner-memory).
 * NO paid calls.
 *
 * Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-team-scoreboard.ts
 */

import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";
import { deriveMeasurementMaturity, detectMeasurementOverlaps } from "@/domains/proof-gsc/measurement-maturity";
import { listPlans } from "@/domains/experiments/daily-experiment-plan-store";
import { findPlanPickForProofId, buildTeamScoreboardSummary } from "@/domains/team-scoreboard/compute-scoreboard";
import { loadTeamScoreboardView } from "@/domains/team-scoreboard/load-team-scoreboard";

const TENANT = process.env.BEACON_GROUND_TRUTH_TENANT ?? "tenant-iranopedia";
// loadShippedChanges()/listPlans() read the AMBIENT tenant - override so this probe reads
// Iranopedia's real ledger/plans instead of whatever .env.local's default tenant is.
process.env.BEACON_TENANT_ID = TENANT;

async function main() {
  console.log(`\n=== team-scoreboard ground-truth - tenant=${TENANT} ===\n`);

  const records = await loadShippedChanges();
  console.log(`Ledger rows loaded: ${records.length}`);
  const byVerdict: Record<string, number> = {};
  for (const r of records) byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
  console.log("Stored verdict breakdown:", JSON.stringify(byVerdict));

  const now = new Date();
  const overlaps = detectMeasurementOverlaps(records.map((r) => ({ id: r.id, path: r.path, shippedAt: r.shippedAt })));
  const maturityCounts: Record<string, number> = {};
  for (const r of records) {
    const basisWin = (r.windows ?? []).filter((w) => w.ran).sort((a, b) => b.day - a.day)[0];
    const m = deriveMeasurementMaturity({
      shippedAt: r.shippedAt,
      now,
      latestGscDate: null,
      windows: (r.windows ?? []).map((w) => ({ day: w.day, ran: w.ran })),
      verdict: r.verdict,
      controlsUsed: basisWin?.controlsUsed ?? 0,
      baselineImpressions: r.baseline?.impressions ?? 0,
      overlap: overlaps.get(r.id) ?? null,
      live: true,
    });
    maturityCounts[m] = (maturityCounts[m] ?? 0) + 1;
  }
  console.log("\nMaturity breakdown (the real eligibility gate, mirrors load-experiment-outcomes.ts):");
  console.log(JSON.stringify(maturityCounts, null, 2));

  const plans = await listPlans(TENANT, 120);
  console.log(`\nPlans loaded (history limit 120): ${plans.length}`);
  let picksWithTeamReview = 0;
  let itemsWithProofId = 0;
  for (const p of plans) {
    for (const pick of p.selected ?? []) if (pick.teamReview) picksWithTeamReview++;
    for (const item of Object.values(p.execution?.items ?? {})) if ((item as { proofId?: string }).proofId) itemsWithProofId++;
  }
  console.log(`Plan picks carrying a teamReview: ${picksWithTeamReview}`);
  console.log(`Execution items carrying a proofId: ${itemsWithProofId}`);

  let joined = 0;
  for (const r of records) {
    const found = findPlanPickForProofId(plans, r.id);
    if (found?.teamReview) joined++;
  }
  console.log(`\nLedger rows that join to a plan pick WITH a team review: ${joined}`);

  console.log("\n--- running buildTeamScoreboardSummary (full recompute, writes to the real store) ---");
  const summary = await buildTeamScoreboardSummary(TENANT, now);
  console.log(`totalSettled=${summary.totalSettled} settledJoined=${summary.settledJoined}`);
  console.log("Per-specialist rows:");
  for (const row of summary.rows) {
    console.log(`  [${row.specialist}] overall: ${JSON.stringify(row.overall)}`);
    for (const [family, tally] of Object.entries(row.byFamily)) {
      console.log(`      (${row.specialist}, ${family}): ${JSON.stringify(tally)}`);
    }
  }

  console.log("\n--- loadTeamScoreboardView (what the Today standup footer would read) ---");
  const view = await loadTeamScoreboardView(TENANT);
  console.log(`footerLine: ${view?.footerLine ?? "(silent - below the minimum or store empty)"}`);
}

main().catch((e) => {
  console.error("ground-truth failed:", e);
  process.exit(1);
});
