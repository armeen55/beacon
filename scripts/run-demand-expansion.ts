/**
 * Sprint 4 live sample — ONE tiny capped DataForSEO keyword-volume call for
 * Iranopedia, then run the opportunity engine over it (2026-06-25).
 *
 * Honors every guardrail: configured-check → 14d cache → hard monthly cap
 * (shared with SERP) → records spend. ONE request, ~one cost line. Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/run-demand-expansion.ts
 */

import { runKeywordVolume } from "@/domains/serp/dataforseo-keywords";
import { buildOpportunities } from "@/domains/demand/keyword-opportunities";
import { loadDemandGraphForTenantCached } from "@/domains/demand-graph/load-graph";

const TENANT = process.env.BEACON_GROUND_TRUTH_TENANT ?? "tenant-iranopedia";

// The operator's suggested seeds + a few on-brand expansions (still ONE call).
const SEEDS = [
  "persian boy names",
  "persian girl names",
  "iran flag",
  "persian numbers",
  "nowruz gifts",
  "iran world cup jersey",
  "persian food recipes",
  "famous iranian people",
  "best cities to visit in iran",
  "iranian movies",
];

async function main() {
  console.log(`\n=== Sprint 4 demand-expansion live sample · tenant=${TENANT} ===\n`);

  console.log(`1) DataForSEO keyword-volume (ONE call, ${SEEDS.length} seeds, capped):`);
  const run = await runKeywordVolume(SEEDS);
  console.log(`   status=${run.status}  cost=$${run.costUsd.toFixed(4)}  detail="${run.detail}"`);
  if (run.status !== "ok" && run.status !== "cache_hit") {
    console.log(`   → not live (status ${run.status}). Honest stop: ${run.status === "disabled" ? "credentials/provider missing" : run.status === "dry_run" ? "DRY-RUN on" : run.status === "capped" ? "cap reached" : "error"}.`);
    if (run.status === "dry_run") console.log(`   (plan would request ${run.plan.keywords.length} keywords, est $${run.plan.estCostUsd})`);
    return;
  }
  console.log(`   returned ${run.keywords.length} keywords (${run.keywords.filter((k) => k.searchVolume != null).length} with real volume):`);
  for (const k of run.keywords.slice(0, 12)) {
    console.log(`     ${(k.searchVolume ?? 0).toLocaleString().padStart(8)}/mo  cpc=$${(k.cpcUsd ?? 0).toFixed(2)}  comp=${k.competitionLevel ?? "?"}  "${k.keyword}"`);
  }

  console.log(`\n2) Owned pages + tenant topics (from the demand graph):`);
  const { graph } = await loadDemandGraphForTenantCached(TENANT);
  const ownedPages = graph.pageNodes.filter((p) => p.isOwned).map((p) => ({ url: p.url }));
  const tenantTopics = [...new Set([...graph.moves.map((m) => m.label), ...ownedPages.map((p) => p.url)])];
  console.log(`   ${ownedPages.length} owned pages, ${tenantTopics.length} topic anchors`);

  console.log(`\n3) Top discovered opportunities:`);
  const opps = buildOpportunities({ keywords: run.keywords, ownedPages, tenantTopics });
  if (opps.length === 0) {
    console.log("   (none passed the volume + relevance gates — honest empty)");
    return;
  }
  opps.slice(0, 10).forEach((o, i) => {
    console.log(
      `   ${String(i + 1).padStart(2)}. [${o.action}] "${o.primaryKeyword}"  ${o.estDemand.toLocaleString()}/mo  ${o.trend}  ${o.confidence}` +
        `  match=${o.matchStrength}${o.matchedPageUrl ? ` (${o.matchedPageUrl.replace(/^https?:\/\/[^/]+/, "")})` : ""}${o.shouldBeTodayMove ? "  ★ Today Move" : ""}`,
    );
    console.log(`        why: ${o.whyNow}${o.risk ? `  ⚠ ${o.risk}` : ""}`);
  });
}

main().catch((e) => {
  console.error("demand-expansion sample failed:", e);
  process.exit(1);
});
