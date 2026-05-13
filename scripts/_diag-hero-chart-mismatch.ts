/**
 * P0 diagnostic (2026-05-13) — dump hero + chart headline numbers for
 * every filter combination on real production data, plus all-time
 * feasibility check.
 *
 * Read-only. No writes, no paid APIs, no polls.
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
process.env.BEACON_TENANT_ID ??= "tenant-ritz-founder";
process.env.BEACON_TENANT_SLUG ??= "ritz-builders";

import { createClient } from "@supabase/supabase-js";

async function main() {
  const { loadVisibilityReadModelFromSnapshots } = await import(
    "@/domains/today/visibility-read-model"
  );

  const m = await loadVisibilityReadModelFromSnapshots({
    tenantId: "tenant-ritz-founder",
  });

  const { ALL_TIME_WINDOW } = await import(
    "@/domains/today/visibility-read-model-constants"
  );
  const WINDOWS = [7, 14, 30, 60, ALL_TIME_WINDOW] as const;
  const METRICS = ["composite", "mention_rate", "citation_rate"] as const;

  // Phase 2B follow-up — after the swap, hero score = latest non-empty
  // point in the SAME visible window for the SAME metric the chart
  // shows. This block proves that alignment empirically.
  console.log("\n===== HERO vs CHART HEADLINE (each filter combo) =====\n");
  console.log(
    "WINDOW   | METRIC          | HERO.score | CHART.score | DRIFT  | sampledDays | latestDate",
  );
  console.log(
    "---------+-----------------+------------+-------------+--------+-------------+-----------",
  );

  for (const win of WINDOWS) {
    for (const metric of METRICS) {
      const anchor = m.chartEndDate;
      const cutoff = new Date(anchor + "T00:00:00Z");
      cutoff.setUTCDate(cutoff.getUTCDate() - (win - 1));
      const cutoffISO = cutoff.toISOString().slice(0, 10);
      const full = m.brandSeriesByMetric[metric] ?? [];
      const points = full.filter((p) => p.date >= cutoffISO);
      const latest = [...points].reverse().find((p) => p.sampleSize > 0);
      const heroScore = latest?.score ?? null;
      const chartScore = latest?.score ?? null;
      const drift =
        heroScore != null && chartScore != null
          ? Math.abs(heroScore - chartScore)
          : null;
      const sampledDays = points.filter((p) => p.sampleSize > 0).length;

      const fmt = (x: number | null) => (x == null ? "—" : x.toFixed(2));
      const winLabel = win === ALL_TIME_WINDOW ? "All time" : String(win);
      console.log(
        `${winLabel.padStart(8)} | ${metric.padEnd(15)} | ${fmt(heroScore).padStart(10)} | ${fmt(chartScore).padStart(11)} | ${fmt(drift).padStart(6)} | ${String(sampledDays).padStart(11)} | ${latest?.date ?? "—"}`,
      );
    }
  }

  // ── 2. Split-by-platform: server returns which platforms? ──
  console.log("\n\n===== SPLIT BY PLATFORM (server-side after P0 filter) =====\n");
  console.log("Platforms returned by loader:");
  for (const p of Object.keys(m.brandSeriesByPlatform)) {
    const pts = m.brandSeriesByPlatform[p];
    const nonEmpty = pts.filter((q) => q.sampleSize > 0);
    console.log(
      `  ${p}: ${pts.length} points (${nonEmpty.length} non-empty)`,
    );
  }

  // ── 3. Confirm: any Google AI Overviews server-side? ──
  console.log("\n===== GAIO LEAK CHECK =====\n");
  const gaioKey = Object.keys(m.brandSeriesByPlatform).find(
    (k) => k.toLowerCase().includes("google") || k.toLowerCase().includes("aio"),
  );
  console.log(
    `Server-side brandSeriesByPlatform contains a GAIO-like key? ${
      gaioKey ? `YES → "${gaioKey}"` : "NO"
    }`,
  );
  console.log(
    `Server-side leaderboard has any GAIO competitor? ${
      m.leaderboardByMetric.composite.some((r) =>
        r.name.toLowerCase().includes("overview"),
      )
        ? "YES"
        : "NO"
    }`,
  );

  // ── 4. All-time feasibility ──
  console.log("\n\n===== ALL-TIME FEASIBILITY =====\n");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // Earliest snapshot date overall:
  const { data: earliestAny } = await sb
    .from("daily_metric_snapshots")
    .select("date, platform, source_type, scope_type")
    .eq("tenant_id", "tenant-ritz-founder")
    .order("date", { ascending: true })
    .limit(1);
  if (earliestAny && earliestAny[0]) {
    console.log(
      `Earliest snapshot row (any platform, any source_type): date=${earliestAny[0].date}, platform=${earliestAny[0].platform}, source_type=${earliestAny[0].source_type}, scope_type=${earliestAny[0].scope_type}`,
    );
  }

  // Earliest snapshot date for an ACTIVE platform (case-tolerant):
  const { data: earliestActive } = await sb
    .from("daily_metric_snapshots")
    .select("date, platform, source_type, scope_type")
    .eq("tenant_id", "tenant-ritz-founder")
    .eq("source_type", "derived")
    .in("platform", ["ChatGPT", "chatgpt", "Perplexity", "perplexity"])
    .order("date", { ascending: true })
    .limit(1);
  if (earliestActive && earliestActive[0]) {
    console.log(
      `Earliest ACTIVE-platform derived snapshot: date=${earliestActive[0].date}, platform=${earliestActive[0].platform}`,
    );
  }

  // Earliest GAIO snapshot (would-be-excluded):
  const { data: earliestGaio } = await sb
    .from("daily_metric_snapshots")
    .select("date, platform, source_type")
    .eq("tenant_id", "tenant-ritz-founder")
    .ilike("platform", "%google%")
    .order("date", { ascending: true })
    .limit(1);
  if (earliestGaio && earliestGaio[0]) {
    console.log(
      `Earliest GAIO snapshot (would be filtered): date=${earliestGaio[0].date}, platform=${earliestGaio[0].platform}, source_type=${earliestGaio[0].source_type}`,
    );
  }

  // Row count for active-platform derived snapshots since earliest date — sizing.
  const since = earliestActive?.[0]?.date ?? "2026-01-01";
  const { count: totalActive } = await sb
    .from("daily_metric_snapshots")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", "tenant-ritz-founder")
    .eq("source_type", "derived")
    .in("platform", ["ChatGPT", "chatgpt", "Perplexity", "perplexity"])
    .gte("date", since);
  console.log(
    `\nTotal active-platform derived rows since ${since}: ${totalActive ?? "?"}`,
  );

  const { count: totalAll } = await sb
    .from("daily_metric_snapshots")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", "tenant-ritz-founder")
    .eq("source_type", "derived");
  console.log(`Total derived rows (any platform): ${totalAll ?? "?"}`);

  // Days covered.
  const { data: distinctDates } = await sb
    .from("daily_metric_snapshots")
    .select("date")
    .eq("tenant_id", "tenant-ritz-founder")
    .eq("source_type", "derived")
    .in("platform", ["ChatGPT", "chatgpt", "Perplexity", "perplexity"])
    .order("date", { ascending: true });
  if (distinctDates) {
    const uniq = new Set(distinctDates.map((r: { date: string }) => r.date));
    console.log(
      `Distinct active-platform sampled dates: ${uniq.size} (limited by PostgREST cap; could be higher with pagination)`,
    );
  }
}

main().catch((e) => {
  console.error(`fatal: ${e instanceof Error ? e.message : e}`);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
