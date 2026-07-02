/** Ground-truth probe (item 24): run the language-gap pass over REAL cached
 *  GSC page signals + page_snapshots for a tenant and print the real language
 *  split (Farsi script / Finglish / English), the top variant families found,
 *  and the biggest gaps. Read-only unless --persist is passed (then it writes
 *  the language-gap store row, exactly what the nightly cron step does).
 *  Run: set -a; . ./.env.local; set +a; BEACON_TENANT_ID=tenant-iranopedia \
 *       npx tsx --require ./scripts/mock-server-only.cjs scripts/_language-gap-probe.ts */
import { runLanguageGapPass } from "@/domains/language-gap/run-language-gap-pass";
import { writeLanguageGapSummary } from "@/domains/language-gap/language-gap-store";
import { clusterVariants } from "@/domains/language-gap/variant-folding";
import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";

async function main() {
  const tenantId = process.env.BEACON_TENANT_ID;
  if (!tenantId) throw new Error("set BEACON_TENANT_ID");
  const t0 = Date.now();
  const pass = await runLanguageGapPass(tenantId);
  const passMs = Date.now() - t0;

  // Extra ground-truth detail beyond what the pass persists: the top
  // transliteration-variant families found across every page's query demand,
  // so the report can name real spelling families (read-only, same cached
  // signals the pass already read).
  const signals = await loadGscPageSignalsForTenant(tenantId);
  const allQueries: Array<{ query: string; impressions: number; clicks: number }> = [];
  for (const s of signals.values()) {
    for (const q of s.topQueries) allQueries.push({ query: q.query, impressions: q.impressions, clicks: q.clicks });
  }
  const clusters = clusterVariants(allQueries).filter((c) => c.variants.length >= 2);

  console.log(
    JSON.stringify(
      {
        tenantId,
        passMs,
        ran: pass.ran,
        pagesWithSignals: signals.size,
        totalQueriesSeen: allQueries.length,
        queriesClassified: pass.queriesClassified,
        farsiScriptCount: pass.farsiScriptCount,
        finglishCount: pass.finglishCount,
        englishCount: pass.englishCount,
        variantFamiliesFound: clusters.length,
        topVariantFamilies: clusters.slice(0, 10).map((c) => ({
          canonicalKey: c.canonicalKey,
          totalImpressions: c.totalImpressions,
          variants: c.variants.map((v) => `${v.query} (${v.impressions})`),
        })),
        gapsFound: pass.gaps.length,
        gaps: pass.gaps,
      },
      null,
      2,
    ),
  );

  if (process.argv.includes("--persist")) {
    if (pass.ran) {
      await writeLanguageGapSummary({
        tenant_id: tenantId,
        computed_at: new Date().toISOString(),
        queriesClassified: pass.queriesClassified,
        farsiScriptCount: pass.farsiScriptCount,
        finglishCount: pass.finglishCount,
        englishCount: pass.englishCount,
        gaps: pass.gaps,
      });
      console.log("persisted language-gap summary for", tenantId);
    } else {
      console.log("pass did not run (no signals) - nothing persisted");
    }
  }
}

main().catch((e) => {
  console.error("probe failed:", e);
  process.exit(1);
});
