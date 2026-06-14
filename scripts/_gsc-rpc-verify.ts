import { readFileSync } from "node:fs"; import { join } from "node:path";
try { const e=readFileSync(join(process.cwd(),".env.local"),"utf-8"); for(const l of e.split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]!]===undefined){let v=m[2]!.trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); process.env[m[1]!]=v;}} } catch {}
process.env.DATA_SOURCE="supabase";
(async()=>{
  const t0 = Date.now();
  const { loadGscPageSignalsForTenant } = await import("@/domains/recommendation-intelligence/gsc-page-signals");
  const m = await loadGscPageSignalsForTenant("tenant-iranopedia");
  console.log(`pages: ${m.size} | load ms: ${Date.now()-t0}`);
  const canon = (u:string)=> u.replace(/^https?:\/\/www\./,"https://").replace(/\/$/,"");
  for(const want of ["persian-male-names","iran-flags","chaharshanbe-suri"]){
    const hit = [...m.values()].find((s:any)=> s.page.includes(want));
    if(hit) console.log(`  ${want}: impr=${hit.impressions90d} clicks=${hit.clicks90d} pos=${hit.position90d.toFixed(1)} | topQ="${hit.topQueries[0]?.query}" (${hit.topQueries[0]?.impressions})`);
    else console.log(`  ${want}: NOT FOUND`);
  }
})().catch(e=>{console.error("ERR", e instanceof Error?e.stack:e); process.exit(1);});
