import { readFileSync } from "node:fs"; import { join } from "node:path";
try { const e=readFileSync(join(process.cwd(),".env.local"),"utf-8"); for(const l of e.split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]!]===undefined){let v=m[2]!.trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); process.env[m[1]!]=v;}} } catch {}
process.env.DATA_SOURCE="supabase";
(async()=>{
  const { loadGscDecaySignalsForTenant } = await import("@/domains/recommendation-intelligence/gsc-page-signals");
  const m = await loadGscDecaySignalsForTenant("tenant-iranopedia");
  console.log("decay signals (pages):", m.size);
  // Pages that DROPPED clicks ≥20% with prior≥some clicks — what the predicate looks for.
  const decaying = [...m.values()].filter((s:any)=> s.clicksPrior >= 10 && s.clicksNow < s.clicksPrior*0.8 && s.positionPrior>0 && s.positionNow>0 && (s.positionNow - s.positionPrior) >= 2);
  const droppedClicks = [...m.values()].filter((s:any)=> s.clicksPrior >= 10 && s.clicksNow < s.clicksPrior*0.8).sort((a:any,b:any)=>(b.clicksPrior-b.clicksNow)-(a.clicksPrior-a.clicksNow));
  console.log("pages meeting FULL decay predicate (clicks -20% + pos worse ≥2):", decaying.length);
  console.log("pages with clicks -20%+ (any position):", droppedClicks.length);
  console.log("\n-- top click-droppers (prior→now clicks, prior→now pos) --");
  for(const s of droppedClicks.slice(0,10)) console.log(`  ${String(s.clicksPrior).padStart(4)}→${String(s.clicksNow).padStart(4)} clk | pos ${s.positionPrior.toFixed(1)}→${s.positionNow.toFixed(1)} | ${s.page}`);
  // Totals sanity: sum clicksNow vs clicksPrior across all pages.
  const tot=(k:string)=>[...m.values()].reduce((a:number,s:any)=>a+(s[k]||0),0);
  console.log(`\ntotals: clicksPrior=${tot("clicksPrior")} clicksNow=${tot("clicksNow")} | imprPrior=${tot("impressionsPrior")} imprNow=${tot("impressionsNow")}`);
})().catch(e=>{console.error("ERR", e instanceof Error?e.stack:e); process.exit(1);});
