/**
 * Ground-truth the N2 query-to-page ownership registry on REAL Iranopedia data
 * (2026-07-02). $0: reads only already-stored gsc_daily_rows (via the
 * gsc_cannibalization_v1 RPC) and already-stored dataforseo_serp_history rows
 * (via intent-clusters-loader.ts) - no live SERP/LLM call happens.
 *
 * Run (from repo root, env sourced):
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-ownership-registry.ts
 */

import { loadOwnershipRegistryForTenant } from "@/domains/ownership/registry-loader";
import { resolveOwner } from "@/domains/ownership/registry";

const TENANT = "tenant-iranopedia";

async function main() {
  console.log(`\n=== N2 ground truth: ownership registry for ${TENANT} ===\n`);

  const registry = await loadOwnershipRegistryForTenant(TENANT);

  console.log(`Registry size (resolved queries): ${registry.byQuery.size}`);
  console.log(`Coverage: ${JSON.stringify(registry.coverage, null, 2)}`);
  const coveragePct =
    registry.coverage.totalQueries > 0
      ? Math.round(((registry.coverage.totalQueries - registry.coverage.unresolvedCount) / registry.coverage.totalQueries) * 100)
      : 0;
  console.log(`Owner coverage: ${coveragePct}% of ${registry.coverage.totalQueries} tracked queries\n`);

  console.log(`=== Real contender conflicts (${registry.conflicts.length}) ===\n`);
  for (const c of registry.conflicts.slice(0, 15)) {
    console.log(`  "${c.key}"  basis=${c.basis}  confidence=${c.confidence}`);
    console.log(`    owner: ${c.owner}`);
    for (const contender of c.contenders) {
      console.log(`    contender: ${contender.url}  share=${(contender.share * 100).toFixed(1)}%  position=${contender.position ?? "n/a"}`);
    }
    console.log(`    reason: ${c.reason}\n`);
  }
  if (registry.conflicts.length === 0) {
    console.log("  (none found today - either no cannibalization exists yet, or coverage is still thin)\n");
  }

  console.log(`=== 3 resolveOwner examples ===\n`);
  // Example 1: exact tracked query. Example 2: a free-text create_page-style
  // topic label (title case, not a literal tracked query) exercising the
  // topic-token fallback path. Example 3: a genuinely unrelated topic, the
  // honest "I don't know yet" null case.
  const examples = ["iran flag", "Persian Male Names", "chaharshanbe suri traditions"];
  for (const q of examples) {
    const entry = resolveOwner(registry, q);
    console.log(`  resolveOwner("${q}") ->`, entry ? { owner: entry.owner, basis: entry.basis, confidence: entry.confidence, contenders: entry.contenders.length } : null);
  }

  console.log(`\n=== Done ===\n`);
}

main().catch((e) => {
  console.error("ground-truth-ownership-registry failed:", e);
  process.exit(1);
});
