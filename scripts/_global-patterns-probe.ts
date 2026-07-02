/** Ground-truth probe (BEACON_500 item 66): run the REAL nightly cross-tenant
 *  aggregation against the live shipped_change_proof ledger + tenants registry,
 *  write the global_patterns table, and print the honest single-tenant-silence
 *  state (distinctTenants per cell, and whether resolvePrior's global backoff
 *  would ever surface a benchmark line today).
 *  Run: set -a; . ./.env.local; set +a; \
 *       npx tsx --require ./scripts/mock-server-only.cjs scripts/_global-patterns-probe.ts */
import { runGlobalPatternsNightlyAggregation, buildGlobalCellLookup } from "@/domains/global-patterns/nightly-aggregate";
import { cellMeetsSurfaceFloor } from "@/domains/global-patterns/rr-pattern";
import { resolvePrior } from "@/domains/learning/experiment-prior";

async function main() {
  const result = await runGlobalPatternsNightlyAggregation();

  console.log(`tenantsScanned: ${result.tenantsScanned}`);
  console.log(`observationsAggregated (mature, decided, non-overridden): ${result.observationsAggregated}`);
  console.log(`written to global_patterns: ${result.written}`);
  console.log(`cells produced: ${result.cells.length}`);
  console.log("");

  if (result.cells.length === 0) {
    console.log("No cells produced (no mature, decided outcomes exist yet). This is honest: nothing to learn from.");
  }

  for (const cell of result.cells) {
    const surfaces = cellMeetsSurfaceFloor(cell);
    console.log(
      `cell ${cell.id} -> n=${cell.n} distinctTenants=${cell.distinctTenants} winRate=${cell.winRate} ` +
        `liftP25=${cell.liftP25} liftP75=${cell.liftP75} surfaceEligible=${surfaces}`,
    );
  }

  console.log("");
  console.log("--- resolvePrior global-backoff check (using the ONE real site category present) ---");
  const category = result.cells[0]?.key.siteCategory ?? "local_residential_builder";
  const lookup = buildGlobalCellLookup(result.cells, category);
  const testActionTypes = ["edit_title", "add_answer_block", "create_page", "add_schema"];
  for (const actionType of testActionTypes) {
    const prior = resolvePrior({ actionType }, new Map(), lookup);
    console.log(
      `actionType=${actionType} -> multiplier=${prior.multiplier} basis=${prior.basis ?? "null"} tag=${prior.tag ?? "null (silent, as expected pre-tenant-3)"}`,
    );
  }

  console.log("");
  console.log(
    result.cells.every((c) => c.distinctTenants < 3)
      ? "HONEST SILENCE CONFIRMED: every cell is below the distinctTenants>=3 surface floor. No benchmark line can appear anywhere in the product from this data."
      : "NOTE: at least one cell already meets the distinctTenants>=3 floor (multiple real tenants have shipped+matured changes in the same bucket).",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
