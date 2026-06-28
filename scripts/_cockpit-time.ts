import { loadTodayCockpit } from "@/domains/action-pack/load-today-cockpit";
import { loadMovesWorklist } from "@/app/(shell)/moves/moves-data";
process.env.BEACON_TENANT_ID = "tenant-iranopedia";
async function main() {
  const t0 = process.hrtime.bigint();
  const c = await loadTodayCockpit();
  console.log(`loadTodayCockpit: ${(Number(process.hrtime.bigint()-t0)/1e9).toFixed(1)}s | top3=${c.topThree.length} totalMoves=${c.biggestOpportunities.totalMoves} newPages=${c.newPagesCount} prepared=${c.preparedMovesCount} aiValidated=${c.aiValidatedCount}`);
  const t1 = process.hrtime.bigint();
  const m = await loadMovesWorklist();
  console.log(`loadMovesWorklist: ${(Number(process.hrtime.bigint()-t1)/1e9).toFixed(1)}s | shown=${m.moves.length} movesReady=${m.stats.movesReady}`);
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
export {};
