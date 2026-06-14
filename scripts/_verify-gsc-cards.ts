import { readFileSync } from "node:fs"; import { join } from "node:path";
try { const e=readFileSync(join(process.cwd(),".env.local"),"utf-8"); for(const l of e.split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]!]===undefined){let v=m[2]!.trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); process.env[m[1]!]=v;}} } catch {}
process.env.DATA_SOURCE="supabase";
(async()=>{
  const { loadGscPageSignalsForTenant } = await import("@/domains/recommendation-intelligence/gsc-page-signals");
  const sig = await loadGscPageSignalsForTenant("tenant-iranopedia");
  console.log("GSC pages with signals:", sig.size);
  const top = [...sig.values()].sort((a,b)=>b.impressions90d-a.impressions90d).slice(0,10);
  console.log("\nTop GSC pages by impressions (28d):");
  for(const s of top) console.log(`  ${Math.round(s.impressions90d).toString().padStart(6)} impr · ${(s.ctr90d*100).toFixed(1).padStart(4)}% CTR · pos ${s.position90d.toFixed(1).padStart(4)} · ${s.page}`);
})().catch(e=>{console.error(e);process.exit(1);});
