import { loadActionPackWorklistForTenant } from "@/domains/action-pack/load";
async function one(mode: "fast"|"full") {
  const t0 = process.hrtime.bigint();
  const w = await loadActionPackWorklistForTenant("tenant-iranopedia", { mode });
  const dt = Number(process.hrtime.bigint()-t0)/1e9;
  console.log(`${mode}: ${dt.toFixed(1)}s | ${w.summary.total} packs | coverage ${JSON.stringify(w.summary.sourceCoverage)} | warnings ${w.summary.warnings.length}`);
  return w;
}
async function main() {
  const full = await one("full");
  const fast = await one("fast");
  const topFull = full.packs.slice(0,20).map(p=>p.id).join(",");
  const topFast = fast.packs.slice(0,20).map(p=>p.id).join(",");
  console.log("TOP-20 identical:", topFull === topFast);
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
export {};
