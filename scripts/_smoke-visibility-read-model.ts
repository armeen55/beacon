/**
 * One-shot smoke: call loadVisibilityReadModelFromSnapshots against
 * production data and print shape + sample values. Verifies the swap
 * end-to-end without needing a signed-in browser.
 *
 * No writes, no paid APIs, no polls/scans.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) process.env[t.slice(0, eq)] ??= t.slice(eq + 1);
  }
}
process.env.BEACON_TENANT_ID = process.env.BEACON_TENANT_ID ?? "tenant-ritz-founder";
process.env.BEACON_TENANT_SLUG = process.env.BEACON_TENANT_SLUG ?? "ritz-builders";

async function main() {
  const { loadVisibilityReadModelFromSnapshots } = await import(
    "@/domains/today/visibility-read-model"
  );
  const t0 = Date.now();
  const out = await loadVisibilityReadModelFromSnapshots({
    tenantId: "tenant-ritz-founder",
  });
  const elapsed = Date.now() - t0;

  console.log(`[smoke] loader returned in ${elapsed}ms`);
  console.log(`[smoke] brandName=${out.brandName}`);
  console.log(`[smoke] chartEndDate=${out.chartEndDate}`);
  console.log(
    `[smoke] brandSeriesByMetric: composite=${out.brandSeriesByMetric.composite.length} mention=${out.brandSeriesByMetric.mention_rate.length} citation=${out.brandSeriesByMetric.citation_rate.length} points`,
  );
  console.log(
    `[smoke] brandSeriesByPlatform: platforms=${Object.keys(out.brandSeriesByPlatform).join(", ")}`,
  );
  for (const p of Object.keys(out.brandSeriesByPlatform)) {
    console.log(
      `[smoke]   ${p}: ${out.brandSeriesByPlatform[p].length} points`,
    );
  }
  console.log(
    `[smoke] leaderboardByMetric.composite: ${out.leaderboardByMetric.composite.length} rows`,
  );
  for (const e of out.leaderboardByMetric.composite) {
    console.log(
      `[smoke]   ${e.rank}. ${e.name}${e.isOwned ? " (you)" : ""} score=${e.score.toFixed(2)} delta=${e.delta?.toFixed(2) ?? "—"} mentions=${e.mentionCount} sampledDays=${e.currentSampledDays}/${e.previousSampledDays}`,
    );
  }
  console.log(
    `[smoke] leaderboardByMetricAndWindow: composite{7=${out.leaderboardByMetricAndWindow.composite[7]?.length} 14=${out.leaderboardByMetricAndWindow.composite[14]?.length} 30=${out.leaderboardByMetricAndWindow.composite[30]?.length} 60=${out.leaderboardByMetricAndWindow.composite[60]?.length}}`,
  );
  console.log(
    `[smoke] competitorSeriesByMetric.composite: ${out.competitorSeriesByMetric.composite.length} competitors`,
  );
  for (const c of out.competitorSeriesByMetric.composite) {
    console.log(`[smoke]   ${c.name}: ${c.points.length} points`);
  }
  console.log(`[smoke] chartEvents: ${out.chartEvents.length} events`);

  // Sanity checks
  const okBrandComposite = out.brandSeriesByMetric.composite.length > 0;
  const okPlatforms = Object.keys(out.brandSeriesByPlatform).length > 0;
  const okLeaderboard = out.leaderboardByMetric.composite.length > 0;
  const brandRow = out.leaderboardByMetric.composite.find((e) => e.isOwned);
  const okBrandPresent = !!brandRow;
  console.log(
    `\n[smoke] sanity: brandSeries=${okBrandComposite ? "OK" : "FAIL"} · platforms=${okPlatforms ? "OK" : "FAIL"} · leaderboard=${okLeaderboard ? "OK" : "FAIL"} · brandInLeaderboard=${okBrandPresent ? "OK" : "FAIL"}`,
  );
  if (!okBrandComposite || !okPlatforms || !okLeaderboard || !okBrandPresent) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`fatal: ${e instanceof Error ? e.message : e}`);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
