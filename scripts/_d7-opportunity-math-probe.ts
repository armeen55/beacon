/**
 * D7 ground-truth probe (2026-07-02, DREAM SITE V1) - real Iranopedia data: prints the OLD naive
 * claim (raw demand-graph weight / GSC impressions, labeled "opportunity") vs the NEW
 * opportunity-math.ts range + honest basis sentence, for real top pages. Not a product surface -
 * a one-off verification. Reads GSC directly (bypassing the full worklist's 5s-per-batch timeout
 * wrapper, which can starve under this script's cold-cache/no-prewarm conditions) so the top
 * query signal is reliably present when it exists. Run:
 *   set -a; . ./.env.local; set +a
 *   BEACON_TENANT_ID=tenant-iranopedia npx tsx --require ./scripts/mock-server-only.cjs scripts/_d7-opportunity-math-probe.ts
 */
process.env.BEACON_TENANT_ID = process.env.BEACON_TENANT_ID || "tenant-iranopedia";

import { loadMovesWorklist } from "@/app/(shell)/moves/moves-data";
import { loadTopQueriesForPages } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { computeOpportunity } from "@/domains/forecast/opportunity-math";

async function main() {
  const tenantId = "tenant-iranopedia";
  const wl = await loadMovesWorklist().catch((e) => {
    console.log("worklist load failed:", String(e).slice(0, 200));
    return { moves: [] as any[] };
  });
  const moves = wl.moves ?? [];
  console.log(`\n=== D7 ground truth: ${moves.length} moves loaded ===\n`);

  const urls = [...new Set(moves.map((m: any) => m.targetUrl).filter(Boolean))] as string[];
  const qmap = await loadTopQueriesForPages(tenantId, urls);

  const rows: Array<{ m: any; tq: any; f: ReturnType<typeof computeOpportunity> }> = [];
  for (const m of moves) {
    const tq = [...(qmap.get(m.targetUrl) ?? [])].sort((a: any, b: any) => b.impressions - a.impressions)[0] ?? null;
    const f = computeOpportunity({
      tenantId,
      page: m.targetUrl,
      lever: m.action,
      currentPosition: tq?.position ?? null,
      impressions90d: tq?.impressions ?? null,
      clicks90d: tq?.clicks ?? null,
    });
    rows.push({ m, tq, f });
  }

  // Sort by the OLD naive claim (demand) so we probe the exact "top opportunities" the operator
  // used to see under the old, naive ranking - the ones most likely to carry an inflated claim.
  const top10 = [...rows].sort((a, b) => (b.m.demand ?? 0) - (a.m.demand ?? 0)).slice(0, 10);

  for (const [i, { m, tq, f }] of top10.entries()) {
    console.log(`--- #${i + 1} ${m.pageLabel} (${m.action}) ---`);
    console.log(`  page: ${m.targetUrl}`);
    console.log(`  topQuery: ${tq ? `"${tq.query}" pos=${tq.position.toFixed(2)} impr=${tq.impressions} clicks=${tq.clicks} ctr=${((tq.clicks / tq.impressions) * 100).toFixed(2)}%` : "none (no live GSC query signal)"}`);
    console.log(`  OLD claim: demand=${m.demand ?? "null"} (${m.demandBasis ?? "no basis"}) <- this used to become "upside"/"demandAtStake"`);
    console.log(`  NEW range: ${f.lowPerMonth != null ? `${f.lowPerMonth} to ${f.highPerMonth} clicks/mo within ${f.days} days` : "null (honest gap)"}`);
    console.log(`  NEW basis: ${f.basis}`);
    console.log(`  hypothesisId: ${f.hypothesisId}`);
    console.log("");
  }

  const oldTotal = top10.reduce((s, { m }) => s + (m.demand ?? 0), 0);
  const newTotal = top10.reduce((s, { f }) => s + (f.lowPerMonth != null && f.highPerMonth != null ? (f.lowPerMonth + f.highPerMonth) / 2 : 0), 0);
  console.log(`=== Sum across these 10 (the old "demandAtStake" style aggregate): OLD=${Math.round(oldTotal).toLocaleString()} vs NEW=${Math.round(newTotal).toLocaleString()} clicks/mo ===`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
export {};
