import { readFileSync } from "node:fs"; import { join } from "node:path";
try { const e=readFileSync(join(process.cwd(),".env.local"),"utf-8"); for(const l of e.split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]!]===undefined){let v=m[2]!.trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); process.env[m[1]!]=v;}} } catch {}
process.env.DATA_SOURCE="supabase";
(async()=>{
  const TENANT="tenant-iranopedia";
  const { loadTriggerCandidatesForTenant } = await import("@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant");
  const { getBusinessConfig } = await import("@/lib/business-config");
  const { classifyPageType } = await import("@/domains/recommendation-intelligence/page-classifier");
  const { applyPromotionSafetyGates } = await import("@/domains/recommendation-intelligence/safety-gates");

  const cfg:any = await getBusinessConfig(TENANT);
  console.log("contentSiteMode:", cfg?.contentSiteMode, "| domain:", cfg?.domain, "| urlPatterns:", JSON.stringify(cfg?.urlPatterns ?? null));

  const res:any = await loadTriggerCandidatesForTenant({ tenantId: TENANT });
  const cands:any[] = res.candidates ?? res.rows ?? (Array.isArray(res)?res:[]);
  const gsc = cands.filter((c:any)=>String(c.trigger_signal??"").startsWith("gsc"));
  console.log(`\nGSC candidates: ${gsc.length} (of ${cands.length} total)\n`);

  const now = new Date();
  const reasons = new Map<string,number>();
  const ptypes = new Map<string,number>();
  let shown=0;
  for(const c of gsc){
    const pt = c.target_url ? classifyPageType(c.target_url, cfg) : null;
    ptypes.set(String(pt), (ptypes.get(String(pt))??0)+1);
    const outcome = applyPromotionSafetyGates(c, {
      tenantId: TENANT,
      targetPageType: pt,
      recommendedEdits: [],
      recommendationResponses: [],
      prerequisiteResolved: true,
      now,
    });
    const key = outcome.eligible ? "ELIGIBLE" : (outcome.suppression_reason ?? "?");
    reasons.set(key,(reasons.get(key)??0)+1);
    if(shown<12){ console.log(`  ${outcome.eligible?"✓":"✗"} ${String(key).padEnd(24)} pt=${String(pt).padEnd(8)} ${c.action_type} | ${c.target_url}`); shown++; }
  }
  console.log("\n-- page types --"); for(const[k,n]of[...ptypes.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log("\n-- gate outcomes --"); for(const[k,n]of[...reasons.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
})().catch(e=>{console.error("ERR", e instanceof Error?e.stack:e); process.exit(1);});
