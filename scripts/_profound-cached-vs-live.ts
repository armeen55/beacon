/** Prove the durable cached reader reproduces the live compiler's decisions. */
import { loadProfoundCoverageForTenant } from "@/domains/profound-coverage/load";
import { loadCachedProfoundCoverageForTenant } from "@/domains/profound-coverage/load-cached";
const top = (packs: {prompt:string;action:string;priorityScore:number}[], n=20) =>
  packs.slice(0, n).map((p) => `${p.action} :: ${p.prompt}`);
async function main() {
  const tL = Date.now();
  const live = await loadProfoundCoverageForTenant("tenant-iranopedia");
  const liveMs = Date.now() - tL;
  const tC = Date.now();
  const cached = await loadCachedProfoundCoverageForTenant("tenant-iranopedia");
  const cachedMs = Date.now() - tC;
  console.log(`LIVE ${(liveMs/1000).toFixed(1)}s summary:`, JSON.stringify(live.summary));
  console.log(`CACHED ${(cachedMs/1000).toFixed(1)}s summary:`, JSON.stringify(cached.summary));
  const L = top(live.actionPacks), C = top(cached.actionPacks);
  const overlap = C.filter((x) => L.includes(x)).length;
  console.log(`\nTop-20 action-pack overlap (cached∩live): ${overlap}/20`);
  console.log("\n=== CACHED top 10 ==="); C.slice(0,10).forEach((x,i)=>console.log(` ${i+1}. ${x}`));
  const onlyLive = L.filter((x)=>!C.includes(x)); const onlyCached = C.filter((x)=>!L.includes(x));
  if (onlyLive.length) { console.log("\nonly in LIVE top20:"); onlyLive.forEach((x)=>console.log("  L:",x)); }
  if (onlyCached.length) { console.log("\nonly in CACHED top20:"); onlyCached.forEach((x)=>console.log("  C:",x)); }
}
main().catch((e)=>{console.error(e);process.exit(1);});
export {};
