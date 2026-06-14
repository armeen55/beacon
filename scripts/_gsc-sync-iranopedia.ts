import { readFileSync } from "node:fs"; import { join } from "node:path";
try { const e=readFileSync(join(process.cwd(),".env.local"),"utf-8"); for(const l of e.split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]!]===undefined){let v=m[2]!.trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); process.env[m[1]!]=v;}} } catch {}
process.env.DATA_SOURCE="supabase";
const startArg = process.argv.find(a=>a.startsWith("--start="))?.split("=")[1];
(async()=>{
  const { syncGscSearchAnalyticsForTenant } = await import("@/lib/connectors/gsc/sync-search-analytics");
  const r = await syncGscSearchAnalyticsForTenant({ tenantId: "tenant-iranopedia", startDate: startArg });
  console.log("GSC sync result:", JSON.stringify(r, null, 2));
})().catch((e)=>{console.error("ERROR:", e instanceof Error?e.message:String(e)); process.exit(1);});
