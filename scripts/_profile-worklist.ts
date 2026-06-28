import { loadDemandGraphForTenant } from "@/domains/demand-graph/load-graph";
import { loadChangePacksForTenant } from "@/domains/demand-graph/gap-compiler";
import { loadCachedProfoundCoverageForTenant } from "@/domains/profound-coverage/load-cached";
import { getLatestMoveDrafts } from "@/domains/demand-graph/move-draft-store";
const T = "tenant-iranopedia";
async function time<X>(name: string, fn: () => Promise<X>): Promise<X> {
  const t0 = process.hrtime.bigint();
  try { const r = await fn(); console.log(`${name}: ${Number(process.hrtime.bigint()-t0)/1e9}s`); return r; }
  catch (e) { console.log(`${name}: FAILED ${Number(process.hrtime.bigint()-t0)/1e9}s ${String(e).slice(0,80)}`); throw e; }
}
async function main() {
  // serial timing to isolate each cost
  await time("demand-graph", () => loadDemandGraphForTenant(T));
  await time("change-packs(60)", () => loadChangePacksForTenant(T, { limit: 60 }));
  await time("change-packs(25)", () => loadChangePacksForTenant(T, { limit: 25 }));
  await time("cached-coverage", () => loadCachedProfoundCoverageForTenant(T));
  await time("move-drafts", () => getLatestMoveDrafts(T));
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
export {};
