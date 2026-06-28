import { loadActionPackWorklistForTenant } from "@/domains/action-pack/load";
async function main() {
  const t0 = process.hrtime.bigint();
  const w = await loadActionPackWorklistForTenant("tenant-iranopedia");
  console.log(`loadActionPackWorklistForTenant (full, end-to-end): ${Number(process.hrtime.bigint()-t0)/1e9}s -> ${w.summary.total} packs`);
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
export {};
