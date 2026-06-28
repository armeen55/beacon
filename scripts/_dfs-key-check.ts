import { loadDemandGraphForTenant } from "@/domains/demand-graph/load-graph";
import { getLatestMoveDrafts } from "@/domains/demand-graph/move-draft-store";
async function main() {
  const [g, drafts] = await Promise.all([loadDemandGraphForTenant("tenant-iranopedia"), getLatestMoveDrafts("tenant-iranopedia")]);
  const verdictKeys = [...drafts.keys()].filter((k)=>k.endsWith("::serp_verdict"));
  console.log("serp_verdict draft keys:", verdictKeys.length, "->", verdictKeys.slice(0,6));
  const createMoves = g.graph.moves.filter((m)=>m.gap==="create_page");
  console.log("create moves:", createMoves.length, "sample demandKeys:", createMoves.slice(0,6).map((m)=>m.demandKey));
  let hits=0; for (const m of g.graph.moves) if (drafts.has(`${m.demandKey}::serp_verdict`)) hits++;
  console.log("moves whose demandKey matches a serp_verdict draft:", hits);
}
main().catch((e)=>{console.error(e);process.exit(1);});
export {};
