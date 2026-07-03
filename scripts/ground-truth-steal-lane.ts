/**
 * Ground-truth the D3 SERP-steal lane on REAL Iranopedia data (2026-07-02).
 *
 * DRY-RUN SAFE BY CONSTRUCTION: maxLiveSerpPulls is forced to 0, so
 * resolveSerpTop5ForKeywords can NEVER call runSerpQuery - only stored
 * dataforseo_serp_history rows are used. No paid API call happens no matter
 * what DATAFORSEO_DRY_RUN is set to in .env.local.
 *
 * Run (from repo root, env sourced):
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs /path/to/this/script.ts
 */

import { loadBeatenKeywordsForTenant, resolveSerpTop5ForKeywords, buildStealBrief } from "@/domains/serp/serp-steal-lane";
import { topicTokens } from "@/domains/evidence/relevance-gate";
import { auditCompetitorPage, getCompetitorAuditsForTenant, isTeardownFresh } from "@/domains/demand-graph/competitor-page-audit";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { rootDomain } from "@/domains/serp/serp-provider";

const TENANT = "tenant-iranopedia";

async function main() {
  console.log(`\n=== D3 ground truth: real beaten keywords for ${TENANT} ===\n`);

  const keywords = await loadBeatenKeywordsForTenant(TENANT, { cap: 10 });
  console.log(`Found ${keywords.length} beaten keyword(s) (position 4-20, >=500 impressions, 28d window):\n`);
  for (const k of keywords) {
    console.log(
      `  "${k.query}"  position=${k.position.toFixed(1)}  impressions=${k.impressions}  clicks=${k.clicks}  page=${k.page}`,
    );
  }
  if (keywords.length === 0) {
    console.log("  (none found - lowering floors or widening the window would be the next step)");
    return;
  }

  const top3 = keywords.slice(0, 3);
  console.log(`\n=== Resolving SERP top-5 for the top ${top3.length} (stored history ONLY, 0 live pulls allowed) ===\n`);
  const { results, livePullsUsed, liveCostUsd } = await resolveSerpTop5ForKeywords(
    TENANT,
    top3.map((k) => k.query),
    { maxLiveSerpPulls: 0 }, // hard $0 guarantee for this ground-truth run
  );
  console.log(`livePullsUsed=${livePullsUsed} liveCostUsd=$${liveCostUsd} (must be 0 for this run)\n`);
  for (const r of results) {
    console.log(`  "${r.query}" source=${r.source} items=${r.items.length} capturedAt=${r.capturedAt ?? "n/a"}`);
    for (const it of r.items.slice(0, 5)) console.log(`     #${it.rank} ${it.domain} ${it.url}`);
  }

  const teardownCache = await getCompetitorAuditsForTenant();
  const nowMs = Date.now();

  console.log(`\n=== Building real steal briefs ===\n`);
  const briefRows: { keyword: string; position: string; impressions: number; competitor: string | null; status: string }[] = [];
  for (const keyword of top3) {
    const serp = results.find((r) => r.query === keyword.query) ?? { query: keyword.query, source: "unavailable" as const, items: [], capturedAt: null };
    const ownDomain = keyword.page ? rootDomain(keyword.page) : "";
    const candidateUrl = serp.items.find((it) => rootDomain(it.domain || it.url) !== ownDomain)?.url ?? null;

    let audit: { fetchStatus: "ok" | "blocked_robots" | "http_error" | "fetch_failed" | "empty"; facts: Awaited<ReturnType<typeof auditCompetitorPage>>["facts"] } | null = null;
    if (candidateUrl) {
      const key = canonicalizeCitationUrl(candidateUrl) || candidateUrl;
      const cached = teardownCache.get(key);
      if (cached && cached.fetchStatus === "ok" && isTeardownFresh(cached.auditedAt, nowMs)) {
        audit = { fetchStatus: cached.fetchStatus, facts: cached.facts };
        console.log(`  [${keyword.query}] using CACHED teardown for ${candidateUrl} (fresh)`);
      } else {
        console.log(`  [${keyword.query}] fetching fresh teardown for ${candidateUrl} (polite fetch, $0)...`);
        const fresh = await auditCompetitorPage(candidateUrl);
        audit = { fetchStatus: fresh.fetchStatus, facts: fresh.facts };
      }
    } else {
      console.log(`  [${keyword.query}] no competitor URL resolvable (no stored SERP for this query)`);
    }

    const ourPageTopicTokens = topicTokens(keyword.query);
    const brief = buildStealBrief({ keyword, serp, competitorUrl: candidateUrl, audit, ourPageTopicTokens });

    briefRows.push({
      keyword: brief.keyword,
      position: brief.ourPosition.toFixed(1),
      impressions: brief.impressions,
      competitor: brief.competitorDomain,
      status: brief.teardownStatus,
    });

    console.log(`\n  --- Steal brief for "${brief.keyword}" ---`);
    console.log(`  teardownStatus: ${brief.teardownStatus}`);
    console.log(`  competitor: ${brief.competitorDomain ?? "none"}`);
    console.log(`  whatWins: ${brief.whatWins ?? "n/a"}`);
    console.log(`  structureGaps: ${JSON.stringify(brief.structureGaps)}`);
    console.log(`  editPointer: ${JSON.stringify(brief.editPointer)}`);
    console.log(`  RENDERED SUMMARY: "${brief.summary}"`);
  }

  console.log(`\n=== Real beaten-keyword + brief table ===\n`);
  console.table(briefRows);
}

main().catch((e) => {
  console.error("Ground truth run failed:", e);
  process.exit(1);
});
