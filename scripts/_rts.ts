import { loadDemandGraphForTenantCached } from "@/domains/demand-graph/load-graph";
import { loadMovesWorklist } from "@/app/(shell)/moves/moves-data";
process.env.BEACON_TENANT_ID="tenant-iranopedia";
async function main(){ await loadDemandGraphForTenantCached("tenant-iranopedia"); const m=await loadMovesWorklist(); console.log("ready_to_review:", m.moves.filter(x=>x.preparedChecklist?.readyToReview).length, "of", m.moves.length); }
main().then(()=>process.exit(0)).catch(e=>{console.error("ERR",String(e).slice(0,120));process.exit(1);});
export {};
