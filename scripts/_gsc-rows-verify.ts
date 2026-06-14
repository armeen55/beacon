import { readFileSync } from "node:fs"; import { join } from "node:path";
try { const e=readFileSync(join(process.cwd(),".env.local"),"utf-8"); for(const l of e.split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]!]===undefined){let v=m[2]!.trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); process.env[m[1]!]=v;}} } catch {}
process.env.DATA_SOURCE="supabase";
process.env.BEACON_TENANT_ID="tenant-iranopedia";
process.env.BEACON_TENANT_SLUG="iranopedia";
(async()=>{
  const { loadLiveRecommendationQueue } = await import("@/domains/recommendations/load-queue");
  const q:any = await loadLiveRecommendationQueue({ tenantId:"tenant-iranopedia" });
  const items:any[] = q.queue ?? [];
  console.log("queue items:", items.length, "| recommendedEdits:", (q.recommendedEdits??[]).length);
  const withGsc = items.filter((it:any)=> it.gscSignal && (it.gscSignal.impressions90d ?? 0) > 0);
  console.log("items with gscSignal (impr>0):", withGsc.length);
  const target = /tehran|iran-flags|persian-male-names|cities|persian-onager|chaharshanbe/i;
  const sample = items.filter((it:any)=> target.test(String(it.resolution?.targetUrl ?? it.targetUrl ?? "")) );
  console.log(`\n-- GSC-page queue items (${sample.length}) — gscSignal attached? --`);
  for(const it of sample.slice(0,12)){
    const url = it.resolution?.targetUrl ?? it.targetUrl ?? "?";
    const g = it.gscSignal;
    console.log(`  ${g? "GSC✓":"GSC✗"} impr=${g?.impressions90d ?? "-"} clicks=${g?.clicks90d ?? "-"} pos=${g?.position90d?.toFixed?.(1) ?? "-"} | ${url}`);
  }
  // Now confirm the #4 floor: run deriveConfidence with the attached impressions.
  const { deriveConfidence } = await import("@/domains/recommendations/derived-confidence");
  console.log("\n-- #4 floor applied to GSC-page items (thin AEO + real demand) --");
  for(const it of sample.slice(0,12)){
    const impr = it.gscSignal?.impressions90d;
    const label = deriveConfidence({ evidenceRefs: [], evidenceDepth: 0, affectedPromptCount: it?.evidence?.promptCount ?? 0, isFaqAnswer: false, hasTopCompetitor: false, gscImpressions: impr });
    const url = it.resolution?.targetUrl ?? it.targetUrl ?? "?";
    console.log(`  ${label.padEnd(16)} (impr=${impr ?? "-"}) ${url}`);
  }
})().catch(e=>{console.error("ERR", e instanceof Error?e.stack:e); process.exit(1);});
