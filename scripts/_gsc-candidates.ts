import { readFileSync } from "node:fs"; import { join } from "node:path";
try { const e=readFileSync(join(process.cwd(),".env.local"),"utf-8"); for(const l of e.split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]!]===undefined){let v=m[2]!.trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); process.env[m[1]!]=v;}} } catch {}
process.env.DATA_SOURCE="supabase";
(async()=>{
  const { loadTriggerCandidatesForTenant } = await import("@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant");
  const res:any = await loadTriggerCandidatesForTenant({ tenantId: "tenant-iranopedia" });
  const cands:any[] = res.candidates ?? res.rows ?? (Array.isArray(res)?res:[]);
  const bySignal = new Map<string,number>();
  for(const c of cands){ const s=c.trigger_signal ?? c.triggerSignal ?? "?"; bySignal.set(s,(bySignal.get(s)??0)+1); }
  console.log("total candidates:", cands.length);
  for(const [s,n] of [...bySignal.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${String(n).padStart(4)}  ${s}`);
  console.log("\n-- sample GSC candidates --");
  for(const c of cands.filter((c:any)=>String(c.trigger_signal??"").startsWith("gsc")).slice(0,8)) console.log(`  ${c.trigger_signal} | ${c.action_type} | ${c.target_url} | ${String(c.customer_copy??c.operator_evidence??"").slice(0,90)}`);
})().catch(e=>{console.error("ERR", e instanceof Error?e.stack:e); process.exit(1);});
