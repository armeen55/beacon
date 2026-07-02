/**
 * Real-data probe for BEACON 500 item 62 (page-factory production line).
 * $0 ONLY: loads real candidates + real cached keyword demand + real graph
 * demand and runs them through validateCandidateDemand + dedupeFactoryCandidates.
 * Does NOT call any LLM drafter, does NOT write anything - a pure read-only
 * preview of "what would this week's batch contain".
 *
 * Run: set -a; . ./.env.local; set +a; BEACON_TENANT_ID=tenant-iranopedia BEACON_TENANT_SLUG=iranopedia \
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/_page-factory-probe.ts
 */
process.env.BEACON_TENANT_ID = process.env.BEACON_TENANT_ID ?? "tenant-iranopedia";
process.env.BEACON_TENANT_SLUG = process.env.BEACON_TENANT_SLUG ?? "iranopedia";

import { loadPageCandidates } from "../src/domains/page-factory/load-page-candidates";
import { loadDemandGraphForTenantCached } from "../src/domains/demand-graph/load-graph";
import { readAllCachedKeywordDemand } from "../src/domains/serp/dataforseo-keywords";
import { validateCandidateDemand, type GraphDemandSignal } from "../src/domains/page-factory/validate-demand";
import { dedupeFactoryCandidates, type ExistingMoveLabel } from "../src/domains/page-factory/dedupe-candidates";
import { loadFactoryBatchHistory } from "../src/domains/page-factory/batch-store";
import { MAX_DRAFTS_PER_WEEK } from "../src/domains/page-factory/production-line";

async function main() {
  const tenantId = process.env.BEACON_TENANT_ID!;
  console.log(`Tenant: ${tenantId}`);

  const rawCandidates = await loadPageCandidates(tenantId, { max: 40 });
  console.log(`\nRaw factory candidates (entity x attribute, deduped against owned pages): ${rawCandidates.length}`);

  const { graph } = await loadDemandGraphForTenantCached(tenantId);
  console.log(`Demand graph moves: ${graph.moves.length}`);

  const priorBatches = await loadFactoryBatchHistory(tenantId).catch(() => []);
  console.log(`Prior page-factory batches: ${priorBatches.length}`);

  const existingMoves: ExistingMoveLabel[] = graph.moves.map((m) => ({ label: m.label, gap: m.gap }));
  const deduped = dedupeFactoryCandidates(rawCandidates, existingMoves, priorBatches);
  console.log(`After dedupe vs open Moves + prior batches: ${deduped.length}`);

  const keywords = await readAllCachedKeywordDemand();
  console.log(`\nCached DataForSEO keyword rows (fresh, <=14d): ${keywords.length}`);

  const graphSignals: GraphDemandSignal[] = graph.moves.map((m) => ({ label: m.label, demand: m.components.demand }));

  const passed: Array<{ title: string; slug: string; source: string; number: number }> = [];
  const queued: string[] = [];
  const rejected: Array<{ title: string; reason: string }> = [];

  for (const c of deduped) {
    const v = validateCandidateDemand(c, keywords, graphSignals);
    if (v.status === "pass") {
      passed.push({
        title: c.title,
        slug: c.slug,
        source: v.source,
        number: v.source === "cached_keyword" ? v.searchVolume : v.demand,
      });
    } else if (v.status === "queued") {
      queued.push(c.title);
    } else {
      rejected.push({ title: c.title, reason: v.reason });
    }
  }

  passed.sort((a, b) => b.number - a.number);

  console.log(`\n=== DEMAND VALIDATION RESULT ===`);
  console.log(`Passed (would enter this week's batch, capped at ${MAX_DRAFTS_PER_WEEK}): ${passed.length}`);
  for (const p of passed.slice(0, MAX_DRAFTS_PER_WEEK)) {
    console.log(`  [DRAFT] ${p.title}  (${p.source}: ${p.number.toLocaleString()})`);
  }
  if (passed.length > MAX_DRAFTS_PER_WEEK) {
    console.log(`  ...and ${passed.length - MAX_DRAFTS_PER_WEEK} more would wait for next week (cap = ${MAX_DRAFTS_PER_WEEK}/week)`);
  }

  console.log(`\nQueued for next keyword batch (no cached data yet): ${queued.length}`);
  for (const q of queued.slice(0, 15)) console.log(`  [QUEUED] ${q}`);
  if (queued.length > 15) console.log(`  ...and ${queued.length - 15} more`);

  console.log(`\nRejected (matched but under the 100/mo floor): ${rejected.length}`);
  for (const r of rejected.slice(0, 10)) console.log(`  [REJECTED] ${r.title} - ${r.reason}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("PROBE FAILED:", e);
    process.exit(1);
  });
