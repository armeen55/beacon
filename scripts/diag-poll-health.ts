/**
 * Phase A read-only diagnostic for poll-health discrepancy.
 *
 * Symptom: Today says "Poll (Apr 24): not yet run" but the operator was
 * charged for 100 prompts. Check whether observations, runs, or snapshots
 * landed and why poll-health doesn't see them.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
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

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  const nowUtc = new Date();
  const todayISO = nowUtc.toISOString().slice(0, 10);
  console.log(`── Poll-health diagnostic ──`);
  console.log(`Now UTC: ${nowUtc.toISOString()}`);
  console.log(`Today UTC date: ${todayISO}`);
  console.log(
    `Local today: ${new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "short" }).format(nowUtc)}\n`,
  );

  // ── observation_runs from 2026-04-22 onward, by date + source ──
  console.log("── observation_runs since 2026-04-22 (ordered desc) ──");
  const { data: runs, error: runsErr } = await sb
    .from("observation_runs")
    .select("run_id, source, scope_label, status, started_at, completed_at")
    .in("source", ["perplexity-native-poll", "openai-native-poll"])
    .gte("started_at", "2026-04-22T00:00:00Z")
    .order("started_at", { ascending: false })
    .limit(50);
  if (runsErr) {
    console.log(`  ERROR: ${runsErr.message}`);
  } else {
    console.log(`  returned ${runs?.length ?? 0} rows`);
    for (const r of runs ?? []) {
      console.log(
        `  ${r.started_at.slice(0, 19)}Z  ${r.source.padEnd(25)} ${r.status.padEnd(10)} ${r.scope_label}`,
      );
    }
  }

  // ── prompt_answer_observations by observed_at date ──
  console.log("\n── prompt_answer_observations by observed_at date ──");
  const { data: obsDates } = await sb
    .from("prompt_answer_observations")
    .select("observed_at, platform")
    .gte("observed_at", "2026-04-22T00:00:00Z")
    .order("observed_at", { ascending: false });
  const obsCountByKey = new Map<string, number>();
  for (const o of obsDates ?? []) {
    const key = `${(o.observed_at as string).slice(0, 10)}|${o.platform}`;
    obsCountByKey.set(key, (obsCountByKey.get(key) ?? 0) + 1);
  }
  for (const [key, n] of [...obsCountByKey.entries()].sort().reverse()) {
    console.log(`  ${key}: ${n}`);
  }

  // ── daily_metric_snapshots for Apr 24 (UTC) ──
  console.log("\n── daily_metric_snapshots for 2026-04-23, 2026-04-24 ──");
  for (const d of ["2026-04-23", "2026-04-24"]) {
    const { count } = await sb
      .from("daily_metric_snapshots")
      .select("*", { count: "exact", head: true })
      .eq("metric_date", d);
    console.log(`  ${d}: ${count ?? 0} rows`);
  }

  // ── Run counts per UTC date (what poll-health itself does) ──
  console.log("\n── observation_runs count by UTC date + source ──");
  const countByDate = new Map<string, number>();
  for (const r of runs ?? []) {
    const key = `${(r.started_at as string).slice(0, 10)}|${r.source}`;
    countByDate.set(key, (countByDate.get(key) ?? 0) + 1);
  }
  for (const [key, n] of [...countByDate.entries()].sort().reverse()) {
    console.log(`  ${key}: ${n}`);
  }

  // ── What poll-health WOULD return for today UTC ──
  console.log(
    `\n── What poll-health query would return for ${todayISO} UTC ──`,
  );
  const dayStart = `${todayISO}T00:00:00.000Z`;
  const dayEnd = `${todayISO}T23:59:59.999Z`;
  const { data: todayRuns, error: todayErr } = await sb
    .from("observation_runs")
    .select("run_id, source, scope_label, status, started_at")
    .in("source", ["perplexity-native-poll", "openai-native-poll"])
    .gte("started_at", dayStart)
    .lte("started_at", dayEnd);
  if (todayErr) {
    console.log(`  ERROR: ${todayErr.message}`);
  } else {
    console.log(`  rows returned by poll-health query: ${todayRuns?.length ?? 0}`);
    for (const r of todayRuns ?? []) {
      console.log(`  ${r.started_at.slice(0, 19)}Z  ${r.source}  ${r.status}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
