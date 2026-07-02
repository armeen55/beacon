/**
 * One-off ground-truth probe (item 3 verification): run the revenue-facts
 * pass for tenant-iranopedia against the live DB.
 * Run: set -a; . ./.env.local; set +a; npx tsx --require ./scripts/mock-server-only.cjs scripts/_revenue-facts-live.ts
 */
import { runRevenueFactsPass } from "../src/domains/revenue/compute-unit-economics";

async function main() {
  const result = await runRevenueFactsPass("tenant-iranopedia");
  console.log(JSON.stringify(result));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
