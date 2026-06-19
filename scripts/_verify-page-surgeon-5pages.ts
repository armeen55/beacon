import { readFileSync } from "node:fs"; import { join } from "node:path";
try { const e=readFileSync(join(process.cwd(),".env.local"),"utf-8"); for(const l of e.split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]!]===undefined){let v=m[2]!.trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); process.env[m[1]!]=v;}} } catch {}
process.env.DATA_SOURCE = "supabase";

const TENANT = "tenant-iranopedia";
const SLUGS = ["funny-farsi-phrases", "cities", "persian-male-names", "farsi-numbers", "iran-flags"];
const LIVE = process.argv.includes("--live"); // re-run the LLM judge; otherwise deterministic

(async () => {
  const { loadPageSurgeonContext, assemblePacketForUrl, topPagesByDemand, evidenceHash } =
    await import("@/domains/recommendation-intelligence/page-surgeon/assemble-packet");
  const { deterministicPageDecision } =
    await import("@/domains/recommendation-intelligence/page-surgeon/page-decision");
  const { judgePageAtomicChange } =
    await import("@/domains/recommendation-intelligence/page-surgeon/llm-judge");
  const { composeArtifactBundle } =
    await import("@/domains/recommendation-intelligence/page-surgeon/artifact-bundle");
  const { qaArtifactBundle } =
    await import("@/domains/recommendation-intelligence/page-surgeon/artifact-qa");

  const ctx = await loadPageSurgeonContext(TENANT, { force: true });
  const top = topPagesByDemand(ctx, 80);
  const siteUrls = [...ctx.snapshotByCanon.values()].map((s) => ({ url: s.url, title: s.title ?? null }));

  const clip = (s: string, n = 240) => (s.length > n ? s.slice(0, n) + "…" : s);

  for (const slug of SLUGS) {
    const canon = top.find((u) => u.replace(/\/$/, "").endsWith("/" + slug)) ??
      [...ctx.snapshotByCanon.keys()].find((u) => u.replace(/\/$/, "").endsWith("/" + slug));
    console.log("\n" + "=".repeat(78));
    if (!canon) { console.log(`/${slug}: NOT FOUND in snapshots/demand`); continue; }
    const packet = assemblePacketForUrl(ctx, canon);
    if (!packet.gsc) { console.log(`/${slug}: no GSC demand`); continue; }
    const g = packet.gsc;
    console.log(`/${slug}  (${canon})`);
    console.log(`  GSC: ${g.impressions} impr · ${g.clicks} clicks · pos ${g.avgPosition.toFixed(1)} · ${(g.ctr*100).toFixed(2)}% CTR · top "${g.topQueries[0]?.query ?? ""}"`);
    console.log(`  sources: present=[${packet.sourcesPresent.join(",")}] empty=[${packet.sourcesConnectedButEmpty.join(",")}]`);

    const decision = LIVE
      ? await judgePageAtomicChange({ packet, brand: ctx.brand })
      : deterministicPageDecision(packet, ctx.brand);

    console.log(`  → action: ${decision.recommended_atomic_action}  (confidence ${decision.confidence}, by ${decision.decided_by})`);
    console.log(`  → primary: ${decision.primary_atomic_change?.action ?? "—"} · supporting ${decision.supporting_atomic_changes.length} · deferred ${decision.deferred_changes?.length ?? 0} · rejected ${decision.rejected_changes.length}`);
    console.log(`  → insight: ${clip(decision.operator_insight)}`);

    const bundle = composeArtifactBundle(decision, packet, siteUrls, []);
    const qa = qaArtifactBundle(bundle, packet, Date.now());
    console.log(`  → QA: ${qa.pass ? "PASS" : "WITHHELD"} (${Math.round(qa.score*100)}%)${qa.factCheckRequired ? "  ⚠ FACT-CHECK" : ""}`);
    if (!qa.pass) console.log(`     withheld: ${qa.failures.join(" | ")}`);
    console.log(`  evidence hash: ${evidenceHash(packet)}`);
  }
  console.log("\n" + "=".repeat(78) + "\nDONE");
})().catch((e) => { console.error("ERROR:", e instanceof Error ? e.stack : String(e)); process.exit(1); });
