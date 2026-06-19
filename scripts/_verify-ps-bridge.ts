import { readFileSync } from "node:fs"; import { join } from "node:path";
try { const e=readFileSync(join(process.cwd(),".env.local"),"utf-8"); for(const l of e.split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]!]===undefined){let v=m[2]!.trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); process.env[m[1]!]=v;}} } catch {}
process.env.DATA_SOURCE = "supabase";
process.env.BEACON_TENANT_ID = "tenant-iranopedia";

const TENANT = "tenant-iranopedia";

(async () => {
  const { loadPageSurgeonForUrl, loadProofPlan } =
    await import("@/domains/recommendation-intelligence/page-surgeon/bridge");

  for (const url of ["https://iranopedia.com/persian-male-names", "https://iranopedia.com/funny-farsi-phrases"]) {
    const r = await loadPageSurgeonForUrl(TENANT, url, { history: true });
    console.log(`\n${url} → status=${r.status}`);
    if (r.status === "pack") {
      const p = r.pack;
      console.log(`  action=${p.headlineAction} conf=${p.confidence} QA=${p.qa.pass ? "pass" : "withheld"} factCheck=${p.qa.factCheckRequired}`);
      console.log(`  pushability=${p.pushability.map((x) => x.method).join(",") || "—"} anyAuto=${p.anyAutoApplicable}`);
      console.log(`  blockers=${p.publishBlockers.length} review=${p.reviewDecision?.verdict ?? "none"} history=${p.history.length}`);
    } else if (r.status === "evidence_only") {
      console.log(`  evidence sources=${r.sourceCoverage.filter((s) => s.used).map((s) => s.source).join(",")} hasGsc=${r.hasGsc}`);
    }
  }

  const proof = await loadProofPlan(TENANT);
  console.log(`\nproof plan rows: ${proof.length}`);
  for (const row of proof.slice(0, 5)) {
    console.log(`  ${row.pageUrl} · ${row.verdict} · check-ins ${row.windows.checkIn7}/${row.windows.checkIn14}/${row.windows.checkIn28} · ${row.metricsToCheck.length} metrics · ${row.controlPaths.length} controls`);
  }
  console.log("\nDONE");
})().catch((e) => { console.error("ERROR:", e instanceof Error ? e.stack : String(e)); process.exit(1); });
