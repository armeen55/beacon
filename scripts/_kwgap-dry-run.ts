// Item 16 ground-truth probe: run the competitor keyword gap batch in DRY-RUN
// against the real tenant. Usage (dry-run FORCED, never spends):
//   set -a; . ./.env.local; set +a
//   DATAFORSEO_DRY_RUN=true BEACON_TENANT_ID=tenant-iranopedia \
//     npx tsx --require ./scripts/mock-server-only.cjs --require ./scripts/_next-cache-shim.cjs scripts/_kwgap-dry-run.ts
import { produceKeywordGaps } from "@/domains/serp/keyword-gap-producer";

async function main() {
  if (process.env.DATAFORSEO_DRY_RUN !== "true") {
    console.error("Refusing to run: set DATAFORSEO_DRY_RUN=true explicitly for this probe.");
    process.exit(1);
  }
  const tenantId = process.env.BEACON_TENANT_ID ?? "tenant-iranopedia";
  const t0 = Date.now();
  const r = await produceKeywordGaps(tenantId);
  console.log(
    JSON.stringify(
      {
        tenantId,
        status: r.status,
        ownDomain: r.ownDomain,
        competitors: r.competitors,
        calls: r.calls,
        spentUsd: r.spentUsd,
        plannedUsd: r.plannedUsd,
        cacheHits: r.cacheHits,
        gapsFound: r.gapsFound,
        topGaps: r.gaps.slice(0, 8).map((g) => ({
          keyword: g.keyword,
          volume: g.volume,
          rank: g.competitorRank,
          by: g.competitorDomain,
          evidence: g.evidence,
        })),
        message: r.message,
        ms: Date.now() - t0,
      },
      null,
      2,
    ),
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
export {};
