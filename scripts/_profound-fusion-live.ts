/** Verify AEO evidence fusion on the REAL demand graph (tenant-iranopedia). */
import { loadDemandGraphForTenant } from "@/domains/demand-graph/load-graph";
async function main() {
  const t0 = Date.now();
  const { graph } = await loadDemandGraphForTenant("tenant-iranopedia");
  const ms = Date.now() - t0;
  const actionable = graph.moves.filter((m) => m.gap !== "low_demand" && m.gap !== "healthy");
  const top = actionable.slice(0, 25);
  const withE = top.filter((m) => m.aeoEvidence);
  console.log(`graph load (incl fusion): ${(ms/1000).toFixed(1)}s | ${graph.moves.length} moves | Top-25 with Profound evidence: ${withE.length}/25`);
  const ex = (gap: string) => top.find((m) => m.aeoEvidence && (gap === "create" ? m.gap === "create_page" : m.gap !== "create_page" && m.ownedUrl));
  for (const tag of ["existing", "create"]) {
    const m = ex(tag);
    if (!m) { console.log(`\n[${tag}] none`); continue; }
    const e = m.aeoEvidence!;
    console.log(`\n[${tag}] ${m.gap} :: ${m.label}  (${m.ownedUrl ?? "no owned page"})`);
    console.log(`  prompt: ${e.prompts[0]}`);
    console.log(`  fanouts(${e.fanoutQueries.length}): ${e.fanoutQueries.slice(0,3).join(" | ")}`);
    console.log(`  AI cites: ${e.topCitedDomains.slice(0,4).map((d)=>d.hostname+"×"+d.answers).join(", ")}`);
    console.log(`  own cited: ${e.ownCitationCount} | conf ${e.confidence} | basis ${e.matchBasis}`);
  }
}
main().catch((e)=>{console.error(e);process.exit(1);});
export {};
