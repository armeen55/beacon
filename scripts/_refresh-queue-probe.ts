/** Ground-truth probe (item 56): run the refresh production line over REAL synced GSC data
 *  for a tenant and print the real quarter-over-quarter refresh queue: which pages are
 *  fading, how many clicks each is losing per month, and the actual evidence brief for the
 *  top candidates (searched queries with no matching H2, the queries each page is losing,
 *  the winner's newer section where a cached teardown exists). Read-only unless --persist is
 *  passed (then it writes the refresh-queue store row, exactly what the nightly PHASE 1i
 *  cron step does).
 *  Run: set -a; . ./.env.local; set +a; BEACON_TENANT_ID=tenant-iranopedia \
 *       npx tsx --require ./scripts/mock-server-only.cjs scripts/_refresh-queue-probe.ts */
import { loadQuarterlyDecayForTenant } from "@/domains/refresh/load-quarterly-decay";
import { rankRefreshCandidates } from "@/domains/refresh/decay-queue";
import { loadRefreshBriefsForTenant } from "@/domains/refresh/refresh-brief-loader";
import { writeRefreshQueueSummary } from "@/domains/refresh/refresh-store";
import { briefSentences } from "@/domains/refresh/refresh-brief";

async function main() {
  const tenantId = process.env.BEACON_TENANT_ID;
  if (!tenantId) throw new Error("set BEACON_TENANT_ID");
  const persist = process.argv.includes("--persist");

  const t0 = Date.now();
  const deltas = await loadQuarterlyDecayForTenant(tenantId);
  console.log(`[probe] quarterly deltas: ${deltas.length} pages in ${Date.now() - t0}ms`);

  const ranked = rankRefreshCandidates(deltas, { limit: 8 });
  console.log(`[probe] refresh queue (floors: >=100 clicks/quarter prior, >=20% drop): ${ranked.length} pages\n`);
  for (const r of ranked) {
    console.log(`  ${r.page}`);
    console.log(`    prior quarter: ${r.priorClicks} clicks @ pos ${r.priorPosition.toFixed(1)} | current: ${r.currentClicks} clicks @ pos ${r.currentPosition.toFixed(1)}`);
    console.log(`    lost: ${r.clicksLostQuarter} clicks/quarter (~${r.clicksLostPerMonth}/month), position drift ${r.positionDrift}`);
    console.log(`    sentence: ${r.sentence}\n`);
  }

  const t1 = Date.now();
  const briefs = await loadRefreshBriefsForTenant(tenantId, ranked);
  console.log(`[probe] briefs built in ${Date.now() - t1}ms\n`);
  for (const b of briefs) {
    console.log(`  BRIEF ${b.page} (hasEvidence=${b.hasEvidence})`);
    console.log(`    new-query gaps (no matching H2): ${b.newQueryGaps.map((g) => `"${g.query}" (${g.impressions} impr)`).join("; ") || "(none)"}`);
    console.log(`    losing queries: ${b.losingQueries.map((l) => `"${l.query}" -${l.dropPct}% (from ${l.priorClicks})`).join("; ") || "(none)"}`);
    console.log(`    winner section: ${b.winnerSection ? `${b.winnerSection.domain} "${b.winnerSection.sectionTitle}" (${b.winnerSection.freshnessDate ?? "no date"})` : "(no on-topic teardown)"}`);
    for (const s of briefSentences(b)) console.log(`    card line: ${s}`);
    console.log("");
  }

  if (persist) {
    await writeRefreshQueueSummary({
      tenant_id: tenantId,
      computed_at: new Date().toISOString(),
      pagesConsidered: deltas.length,
      queue: briefs,
    });
    console.log(`[probe] PERSISTED refresh-queue row for ${tenantId} (${briefs.length} entries)`);
  } else {
    console.log("[probe] read-only (pass --persist to write the store row the cron would)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
