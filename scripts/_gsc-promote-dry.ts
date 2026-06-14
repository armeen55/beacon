import { readFileSync } from "node:fs"; import { join } from "node:path";
try { const e=readFileSync(join(process.cwd(),".env.local"),"utf-8"); for(const l of e.split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]!]===undefined){let v=m[2]!.trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); process.env[m[1]!]=v;}} } catch {}
process.env.DATA_SOURCE="supabase";
process.env.BEACON_TENANT_ID="tenant-iranopedia";
process.env.BEACON_TENANT_SLUG="iranopedia";
(async()=>{
  const { promoteEligibleCandidates } = await import("@/domains/recommendation-intelligence/promotion-writer");
  const res:any = await promoteEligibleCandidates({ tenantId:"tenant-iranopedia", dryRun:true });
  console.log("candidate_count:", res.candidate_count, "| eligible_count:", res.eligible_count, "| promoted_count:", res.promoted_count, "| skipped_count:", res.skipped_count);
  const rows:any[] = res.mapped_rows ?? [];
  const byAction = new Map<string,number>();
  for(const r of rows){ const a=r.action_type ?? "?"; byAction.set(a,(byAction.get(a)??0)+1); }
  console.log("\n-- mapped rows by action --"); for(const[k,n]of[...byAction.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);
  // GSC-flavored rows: target_url among the GSC content pages + edit_title
  const gscish = rows.filter((r:any)=> r.action_type==="edit_title" && !/Add a page title/i.test(String(r.display_label??"")) );
  console.log(`\n-- edit_title rows that are NOT 'Add a page title' (i.e. GSC-driven rewrites): ${gscish.length} --`);
  for(const r of gscish.slice(0,12)) console.log(`  ${r.target_url} | ${String(r.display_label??"").slice(0,70)} | ${String(r.why??"").slice(0,70)}`);
})().catch(e=>{console.error("ERR", e instanceof Error?e.stack:e); process.exit(1);});
