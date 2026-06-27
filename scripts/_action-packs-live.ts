/** Live truth dump: unified ActionPack worklist for tenant-iranopedia. */
import { loadActionPackWorklistForTenant } from "@/domains/action-pack/load";
async function main() {
  const t0 = Date.now();
  const wl = await loadActionPackWorklistForTenant("tenant-iranopedia");
  console.log(`=== UNIFIED ACTION-PACK WORKLIST (${((Date.now()-t0)/1000).toFixed(1)}s) ===`);
  console.log("SUMMARY:", JSON.stringify(wl.summary, null, 0));
  console.log(`\nCollapse: ${wl.summary.rawFromRankRevenue} R&R + ${wl.summary.rawFromProfoundCoverage} coverage = ${wl.summary.rawFromRankRevenue + wl.summary.rawFromProfoundCoverage} raw -> ${wl.summary.total} unified (${wl.summary.duplicatesRemoved} duplicates removed)`);
  console.log("\n=== TOP 20 ACTION PACKS ===");
  for (const [i, p] of wl.packs.slice(0, 20).entries()) {
    console.log(`\n${i+1}. [${p.priorityScore}] ${p.actionType} ${p.targetUrl ?? "/"+(p.newPageSlug ?? "")} (${p.confidence})`);
    console.log(`   ${p.label}`);
    console.log(`   sources: ${p.evidenceSources.join(", ")}${p.profoundReceipt ? ` | AI: "${p.profoundReceipt.topPrompt.slice(0,60)}"` : ""}`);
    console.log(`   why: ${p.whyNotNoise.slice(0, 150)}`);
  }
}
main().catch((e)=>{console.error("fatal", e); process.exit(1);});
export {};
