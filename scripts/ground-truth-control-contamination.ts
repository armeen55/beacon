/**
 * Ground-truth control-contamination (master plan N13) against REAL Iranopedia
 * data. Read-only report: for EVERY shipped-change ledger row, runs the real
 * classifier (attachControlContaminationForLedger -> classifyControls) against
 * the real ledger + real page_snapshots history and reports which comparison
 * pages are contaminated TODAY, why, and whether a clean substitute could be
 * PROMOTED from that ship's own frozen donor pool (never a fresh, post-ship-
 * data-informed pick - see control-contamination.ts's promoteFromFrozenPool).
 * Never writes anything.
 *
 * Expected honest result on the CURRENT 25-ship ledger: every one of them
 * predates the N13 controlDonorPool column (migrations/2026-07-03_shipped_
 * change_proof_control_donor_pool.sql, not yet applied), so `controlDonorPool`
 * is null on every row and every contaminated control correctly reports "no
 * clean substitute available" (0 swaps) rather than fabricating one. A new
 * ship recorded AFTER the migration ships + auto-record-on-ship.ts persists
 * a pool will be eligible for real promotions.
 *
 * Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-control-contamination.ts
 */

import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";
import { attachControlContaminationForLedger } from "@/domains/proof-gsc/attach-control-contamination";

const TENANT = process.env.BEACON_GROUND_TRUTH_TENANT ?? "tenant-iranopedia";
process.env.BEACON_TENANT_ID = TENANT;

async function main() {
  console.log(`\n=== control-contamination ground-truth - tenant=${TENANT} ===\n`);

  const records = await loadShippedChanges();
  console.log(`Ledger rows loaded: ${records.length}`);
  if (records.length === 0) {
    console.log("No shipped-change records for this tenant - nothing to check.");
    return;
  }

  const attachments = await attachControlContaminationForLedger(TENANT, records);

  let contaminatedShips = 0;
  let totalContaminatedControls = 0;
  let swapped = 0;
  let cautioned = 0;
  const table: string[] = [];

  const sorted = [...records].sort((a, b) => (a.shippedAt < b.shippedAt ? 1 : -1));

  for (const r of sorted) {
    const attach = attachments.get(r.id);
    if (!attach) {
      table.push(`${r.path} (${r.actionType}) shipped ${r.shippedAt.slice(0, 10)}: no measurement window yet, skipped`);
      continue;
    }
    if (!attach.verdict.hasContamination) continue;

    contaminatedShips++;
    totalContaminatedControls += attach.verdict.contaminated.length;
    table.push(`\n--- ${r.path} (${r.actionType}) shipped ${r.shippedAt.slice(0, 10)} ---`);
    table.push(`  Controls on record (${r.controlPages.length}): ${r.controlPages.join(", ")}`);
    for (const c of attach.verdict.contaminated) {
      const sub = attach.substitutesByOriginal.get(c.path);
      if (sub) {
        swapped++;
        table.push(`  CONTAMINATED: ${c.path} [${c.status}] -> ${c.reason}`);
        table.push(`    Substitute found: ${sub}`);
      } else {
        cautioned++;
        table.push(`  CONTAMINATED: ${c.path} [${c.status}] -> ${c.reason}`);
        table.push(`    No clean substitute available - reading with caution.`);
      }
    }
    table.push(`  Notes that would render on the card:`);
    for (const n of attach.notes) table.push(`    - ${n}`);
  }

  console.log(`\nShips with at least one measurement window: ${records.filter((r) => attachments.has(r.id)).length}`);
  console.log(`Ships with at least one contaminated control: ${contaminatedShips}`);
  console.log(`Total contaminated controls found: ${totalContaminatedControls}`);
  console.log(`  swapped for a clean substitute: ${swapped}`);
  console.log(`  no substitute found (caution only): ${cautioned}`);
  console.log(table.join("\n"));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ground-truth-control-contamination failed:", e);
    process.exit(1);
  });
