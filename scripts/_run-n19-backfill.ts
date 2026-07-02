/**
 * N19 (2026-07-02) - one-shot operator-triggered run of runContentExcerptBackfill
 * for tenant-iranopedia, limit 5. Persistence path needs no migration
 * (body_paragraph_sample already exists as a live column), so per the item's
 * instructions this runs directly instead of stopping for a migration.
 *
 * Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/_run-n19-backfill.ts
 */
import { runContentExcerptBackfill } from "../src/domains/pages/content-excerpt-backfill";

async function main() {
  const result = await runContentExcerptBackfill("tenant-iranopedia", { limit: 5 });
  console.log(JSON.stringify(result, null, 2));
}

main();
