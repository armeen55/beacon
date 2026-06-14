import { readFileSync } from "node:fs"; import { join } from "node:path";
try { const e=readFileSync(join(process.cwd(),".env.local"),"utf-8"); for(const l of e.split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]!]===undefined){let v=m[2]!.trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); process.env[m[1]!]=v;}} } catch {}
process.env.DATA_SOURCE="supabase";
process.env.BEACON_TENANT_ID="tenant-iranopedia";
process.env.BEACON_TENANT_SLUG="iranopedia";
(async()=>{
  const { promoteEligibleCandidates } = await import("@/domains/recommendation-intelligence/promotion-writer");
  const res:any = await promoteEligibleCandidates({ tenantId:"tenant-iranopedia", dryRun:false });
  console.log("LIVE WRITE → candidate_count:", res.candidate_count, "| eligible:", res.eligible_count, "| promoted:", res.promoted_count, "| skipped:", res.skipped_count, "| sync_warning:", res.sync_warning ?? "none");
})().catch(e=>{console.error("ERR", e instanceof Error?e.stack:e); process.exit(1);});
