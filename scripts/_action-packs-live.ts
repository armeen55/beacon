/** Phase E.0 truth dump: unified worklist (DataForSEO coverage) + parity. */
import { loadActionPackWorklistForTenant } from "@/domains/action-pack/load";
import { loadActionPackParityForTenant } from "@/domains/action-pack/parity";
async function main() {
  const wl = await loadActionPackWorklistForTenant("tenant-iranopedia");
  console.log("SUMMARY:", JSON.stringify(wl.summary));
  console.log("collapse:", wl.summary.rawFromRankRevenue + wl.summary.rawFromProfoundCoverage, "raw ->", wl.summary.total, "unified;", wl.summary.duplicatesRemoved, "dupes");
  console.log("DataForSEO coverage:", wl.summary.sourceCoverage.dataforseo, "packs");
  for (const p of wl.packs.filter((x)=>x.dataforseoValidation).slice(0,3)) console.log(`  DFS: ${p.label} -> ${p.dataforseoValidation!.verdict} [${p.dataforseoValidation!.topDomains.slice(0,3).join(", ")}]`);
  console.log("\nTOP 20:");
  for (const [i,p] of wl.packs.slice(0,20).entries()) console.log(` ${i+1}. [${p.priorityScore}] ${p.actionType} ${(p.targetUrl??("/"+(p.newPageSlug??""))).slice(0,60)} | ${p.evidenceSources.join("+")}`);
  const r = await loadActionPackParityForTenant("tenant-iranopedia");
  console.log("\nPARITY (actionPackTotal", r.actionPackTotal, "):");
  for (const s of r.surfaces) console.log(`  ${s.verdict.padEnd(15)} ${s.represented}/${s.legacyRows} (${s.pct}%) ${s.surface}`);
  console.log("legacy-only gaps:", r.legacyOnlySamples.length, "->", r.legacyOnlySamples.slice(0,5));
}
main().catch((e)=>{console.error("fatal",e);process.exit(1);});
export {};
