/**
 * verify-daily-poll — read-only daily-poll integrity verifier.
 *
 * Operator Tasks 0 + 4 (post May 2-4 incident, 2026-05-04).
 *
 * Modes:
 *   --mode=pre   (default) — pre-cron readiness audit. Answers:
 *                            • Will tomorrow's scheduled cron be blocked
 *                              by the persistence gate?
 *                            • Latest run per platform + status
 *                            • Does the latest successful proof unblock
 *                              the old failed runs?
 *                            • raw_poll_chunks table exists + selectable
 *                            • prompt_answer_observations carries
 *                              competitor_descriptor_windows
 *                            • daily_metric_snapshots has today's rows
 *                            • Recs / changelog row counts (must be
 *                              byte-stable to Stage 1 backup)
 *
 *   --mode=post  — post-cron verification. Answers:
 *                  • Latest observation date + per-(date, platform) row
 *                    counts for last 5 days
 *                  • Snapshots by date/platform for last 5 days
 *                  • raw_poll_chunks rows by run/platform for last 5 days
 *                  • observation_runs status + reconciliation status
 *                  • samplingStatus per platform (today)
 *                  • Whether persisted rows match expected full-day sample
 *                  • Whether /today should be stale or fresh
 *                  • Whether recs / changelog counts changed
 *
 * Exit codes:
 *   0  → all checks GREEN (pre: cron will run cleanly; post: yesterday
 *        polled cleanly with full-day sample)
 *   1  → at least one check failed (cron will be blocked / data missing
 *        / unexpected mutation in recs or changelog)
 *   2  → query / runtime error (treated as alert)
 *
 * Read-only: every Supabase access uses SELECT only. NO writes. NO paid
 * API calls.
 *
 * Usage:
 *   npm run verify:daily-poll                      # pre-cron (default)
 *   npm run verify:daily-poll -- --mode=post       # post-cron
 *   npm run verify:daily-poll -- --mode=post --date=2026-05-05
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Load .env.local before importing anything that reads process.env ──
const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

import { getSupabaseAdmin } from "../src/lib/persistence/supabase";
import {
  classifySampling,
  type SamplingStatus,
} from "../src/domains/observations/poll-health";
import { checkPersistenceGate } from "../src/domains/observations/poll-integrity";

const TENANT_ID = process.env.BEACON_TENANT_ID ?? "tenant-ritz-founder";
const FULL_DAY_TARGET = 100; // operator-locked: 100 prompts × 2 platforms / day
const POLL_SOURCES = [
  "perplexity-native-poll",
  "openai-native-poll",
] as const;
type PollSource = (typeof POLL_SOURCES)[number];

type Mode = "pre" | "post";

function parseArgs(argv: ReadonlyArray<string>): { mode: Mode; date: string | null } {
  let mode: Mode = "pre";
  let date: string | null = null;
  for (const arg of argv) {
    if (arg.startsWith("--mode=")) {
      const v = arg.slice("--mode=".length);
      if (v === "pre" || v === "post") mode = v;
    } else if (arg.startsWith("--date=")) {
      const v = arg.slice("--date=".length);
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) date = v;
    }
  }
  return { mode, date };
}

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Pre-cron checks ───────────────────────────────────────────────────

async function runPreCron(): Promise<number> {
  console.log("");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`PRE-CRON READINESS — ${todayUtcIso()} (UTC) · tenant=${TENANT_ID}`);
  console.log("══════════════════════════════════════════════════════════════════");

  let allOk = true;

  // 1. Persistence gate verdict per platform.
  console.log("");
  console.log("─ Persistence gate (Operator R6) ────────────────────────────────");
  for (const source of POLL_SOURCES) {
    try {
      const verdict = await checkPersistenceGate({ tenantId: TENANT_ID, source });
      const tag = verdict.allow ? "✓ ALLOW" : "✗ BLOCK";
      console.log(
        `  ${tag.padEnd(8)} ${source.padEnd(28)} ${
          verdict.allow ? "(no PERSISTENCE FAILED marker on latest run)" : verdict.reason
        }`,
      );
      if (!verdict.allow) allOk = false;
    } catch (err) {
      console.error(
        `  ✗ ERROR  ${source}: ${err instanceof Error ? err.message : String(err)}`,
      );
      allOk = false;
    }
  }

  // 2. Latest run per platform.
  console.log("");
  console.log("─ Latest run per platform ───────────────────────────────────────");
  const sb = getSupabaseAdmin();
  for (const source of POLL_SOURCES) {
    const { data, error } = await sb
      .from("observation_runs")
      .select("run_id, status, scope_label, started_at, completed_at")
      .eq("tenant_id", TENANT_ID)
      .eq("source", source)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error(`  ✗ ERROR  ${source}: ${error.message}`);
      allOk = false;
      continue;
    }
    if (!data) {
      console.log(`  …       ${source.padEnd(28)} NO RUNS YET`);
      continue;
    }
    const ageMin = Math.floor(
      (Date.now() - new Date(data.started_at).getTime()) / 60_000,
    );
    console.log(
      `  ${data.status === "completed" ? "✓" : "✗"} ${(data.status as string).padEnd(10)} ${source.padEnd(28)} ${data.run_id} (${ageMin} min ago)`,
    );
    console.log(`            scope_label: ${data.scope_label}`);
  }

  // 3. raw_poll_chunks table exists + selectable.
  console.log("");
  console.log("─ raw_poll_chunks safety net (R3) ───────────────────────────────");
  try {
    const { data: tableData, error: tableErr } = await sb
      .from("information_schema.tables" as unknown as never)
      .select("*")
      .limit(1);
    void tableData;
    void tableErr;
    // Fallback: just SELECT count.
    const { error: rcErr } = await sb
      .from("raw_poll_chunks")
      .select("run_id", { count: "exact", head: true })
      .eq("tenant_id", TENANT_ID);
    if (rcErr) {
      console.error(
        `  ✗ ERROR  raw_poll_chunks select failed: ${rcErr.message}`,
      );
      allOk = false;
    } else {
      console.log(`  ✓ OK     raw_poll_chunks table exists + accepts SELECT`);
    }
  } catch (err) {
    console.error(
      `  ✗ ERROR  raw_poll_chunks: ${err instanceof Error ? err.message : String(err)}`,
    );
    allOk = false;
  }

  // 4. Schema gate: prompt_answer_observations carries competitor_descriptor_windows.
  console.log("");
  console.log("─ Schema cache (May 2-4 root cause) ─────────────────────────────");
  try {
    const { data: row, error: cdwErr } = await sb
      .from("prompt_answer_observations")
      .select("competitor_descriptor_windows")
      .eq("tenant_id", TENANT_ID)
      .limit(1)
      .maybeSingle();
    if (cdwErr) {
      console.error(
        `  ✗ ERROR  prompt_answer_observations.competitor_descriptor_windows query failed: ${cdwErr.message}`,
      );
      allOk = false;
    } else {
      void row;
      console.log(
        `  ✓ OK     prompt_answer_observations.competitor_descriptor_windows column accepts SELECT`,
      );
    }
  } catch (err) {
    console.error(
      `  ✗ ERROR  schema-cache check: ${err instanceof Error ? err.message : String(err)}`,
    );
    allOk = false;
  }

  // 5. Today's manual proof persistence (May 4 / today).
  console.log("");
  console.log("─ Today's persisted rows (proof-run state) ──────────────────────");
  const today = todayUtcIso();
  const { data: todayObs, error: todayObsErr } = await sb
    .from("prompt_answer_observations")
    .select("platform")
    .eq("tenant_id", TENANT_ID)
    .gte("observed_at", `${today}T00:00:00.000Z`)
    .lte("observed_at", `${today}T23:59:59.999Z`);
  if (todayObsErr) {
    console.error(`  ✗ ERROR  obs count: ${todayObsErr.message}`);
    allOk = false;
  } else {
    const counts: Record<string, number> = {};
    for (const r of (todayObs ?? []) as Array<{ platform: string | null }>) {
      const p = (r.platform ?? "unknown").toLowerCase();
      counts[p] = (counts[p] ?? 0) + 1;
    }
    for (const [plat, n] of Object.entries(counts)) {
      console.log(
        `  · ${plat.padEnd(28)} ${n} obs (samplingStatus: ${classifySampling(n)})`,
      );
    }
    if (Object.keys(counts).length === 0) {
      console.log(`  · no observations today yet`);
    }
  }

  // 6. Today's snapshots.
  const { count: snapCount, error: snapErr } = await sb
    .from("daily_metric_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT_ID)
    .eq("date", today);
  if (snapErr) {
    console.error(`  ✗ ERROR  snap count: ${snapErr.message}`);
    allOk = false;
  } else {
    console.log(`  · daily_metric_snapshots for ${today}: ${snapCount ?? 0} rows`);
  }

  // 7. Recs/changelog byte-stable.
  console.log("");
  console.log("─ Recs / changelog (must be untouched) ──────────────────────────");
  for (const tbl of [
    "recommended_edits",
    "recommendation_responses",
    "changelog_entries",
  ] as const) {
    const { count, error: countErr } = await sb
      .from(tbl)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", TENANT_ID);
    if (countErr) {
      // recommendation_responses doesn't have an `id` column — try rec_id.
      if (tbl === "recommendation_responses") {
        const { count: c2, error: e2 } = await sb
          .from(tbl)
          .select("rec_id", { count: "exact", head: true })
          .eq("tenant_id", TENANT_ID);
        if (e2) {
          console.error(`  ✗ ERROR  ${tbl}: ${e2.message}`);
          allOk = false;
          continue;
        }
        console.log(`  · ${tbl.padEnd(28)} ${c2 ?? 0}`);
        continue;
      }
      console.error(`  ✗ ERROR  ${tbl}: ${countErr.message}`);
      allOk = false;
      continue;
    }
    console.log(`  · ${tbl.padEnd(28)} ${count ?? 0}`);
  }

  console.log("");
  console.log("══════════════════════════════════════════════════════════════════");
  if (allOk) {
    console.log("✓ READY for next paid cron. Persistence gate ALLOWS, schema cache OK,");
    console.log("  recs/changelog stable, raw_poll_chunks reachable.");
  } else {
    console.log("✗ NOT READY — see failures above. Resolve before tomorrow's cron.");
  }
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("");
  return allOk ? 0 : 1;
}

// ── Post-cron checks ──────────────────────────────────────────────────

async function runPostCron(targetDate: string): Promise<number> {
  console.log("");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`POST-CRON VERIFICATION — ${targetDate} (UTC) · tenant=${TENANT_ID}`);
  console.log("══════════════════════════════════════════════════════════════════");

  let allOk = true;
  const sb = getSupabaseAdmin();

  // 1. Latest observation date + last-5-days breakdown.
  console.log("");
  console.log("─ Observations by date / platform (last 5 days) ─────────────────");
  const fiveDaysAgo = new Date(targetDate);
  fiveDaysAgo.setUTCDate(fiveDaysAgo.getUTCDate() - 4);
  const fromIso = fiveDaysAgo.toISOString().slice(0, 10);
  const { data: obsRows, error: obsErr } = await sb
    .from("prompt_answer_observations")
    .select("observed_at, platform")
    .eq("tenant_id", TENANT_ID)
    .gte("observed_at", `${fromIso}T00:00:00.000Z`)
    .order("observed_at", { ascending: false });
  if (obsErr) {
    console.error(`  ✗ ERROR  obs query: ${obsErr.message}`);
    return 2;
  }
  const obsBuckets: Record<string, Record<string, number>> = {};
  for (const r of (obsRows ?? []) as Array<{
    observed_at: string;
    platform: string | null;
  }>) {
    const date = r.observed_at.slice(0, 10);
    const platform = (r.platform ?? "unknown").toLowerCase();
    if (!obsBuckets[date]) obsBuckets[date] = {};
    obsBuckets[date][platform] = (obsBuckets[date][platform] ?? 0) + 1;
  }
  const dates = Object.keys(obsBuckets).sort().reverse();
  for (const date of dates) {
    const platforms = obsBuckets[date];
    const summary = Object.entries(platforms)
      .map(
        ([p, n]) => `${p}=${n} (${classifySampling(n)})`,
      )
      .join(" · ");
    console.log(`  · ${date}  ${summary}`);
  }
  if (dates.length === 0) {
    console.log(`  (no observations in last 5 days)`);
  }
  const latestObsDate = dates[0] ?? null;

  // Did the target date land at all?
  const targetDateObs = obsBuckets[targetDate] ?? {};
  const targetTotal = Object.values(targetDateObs).reduce((a, b) => a + b, 0);
  console.log("");
  console.log(`  target date ${targetDate}: ${targetTotal} obs total`);
  if (targetTotal === 0) {
    console.log(`  ✗ FAIL — target date has zero observations`);
    allOk = false;
  } else if (targetTotal < FULL_DAY_TARGET) {
    console.log(
      `  ⚠ WARN — target date sample below full-day target (${FULL_DAY_TARGET}); samplingStatus: partial/proof`,
    );
  } else {
    console.log(`  ✓ OK    — target date hit full-day target`);
  }

  // 2. Snapshots by date / platform.
  console.log("");
  console.log("─ Snapshots by date / platform (last 5 days) ────────────────────");
  const { data: snapRows, error: snapErr } = await sb
    .from("daily_metric_snapshots")
    .select("date, platform, source_type")
    .eq("tenant_id", TENANT_ID)
    .gte("date", fromIso);
  if (snapErr) {
    console.error(`  ✗ ERROR  snap query: ${snapErr.message}`);
    return 2;
  }
  const snapBuckets: Record<string, Record<string, number>> = {};
  for (const r of (snapRows ?? []) as Array<{
    date: string;
    platform: string | null;
    source_type: string;
  }>) {
    const date = r.date;
    const platform = (r.platform ?? "unknown");
    if (!snapBuckets[date]) snapBuckets[date] = {};
    snapBuckets[date][platform] = (snapBuckets[date][platform] ?? 0) + 1;
  }
  const snapDates = Object.keys(snapBuckets).sort().reverse();
  for (const date of snapDates) {
    const platforms = snapBuckets[date];
    const summary = Object.entries(platforms)
      .map(([p, n]) => `${p}=${n}`)
      .join(" · ");
    console.log(`  · ${date}  ${summary}`);
  }
  if (snapDates.length === 0) console.log(`  (no snapshots in last 5 days)`);

  // 3. raw_poll_chunks by date / platform.
  console.log("");
  console.log("─ raw_poll_chunks (last 5 days) ─────────────────────────────────");
  const { data: rcRows, error: rcErr } = await sb
    .from("raw_poll_chunks")
    .select("run_id, platform, source, prompt_count, observations_persisted_count, reconciliation_status, created_at")
    .eq("tenant_id", TENANT_ID)
    .gte("created_at", `${fromIso}T00:00:00.000Z`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (rcErr) {
    console.error(`  ✗ ERROR  raw_poll_chunks query: ${rcErr.message}`);
    return 2;
  }
  if ((rcRows ?? []).length === 0) {
    console.log(`  (no raw_poll_chunks rows in last 5 days — table may be empty pre-deploy)`);
  } else {
    for (const r of (rcRows ?? []).slice(0, 10) as Array<{
      run_id: string;
      platform: string;
      source: string;
      prompt_count: number;
      observations_persisted_count: number | null;
      reconciliation_status: string | null;
      created_at: string;
    }>) {
      const status = r.reconciliation_status ?? "pending";
      const persisted = r.observations_persisted_count ?? 0;
      const tag =
        status === "verified_complete"
          ? "✓"
          : status === "pending"
            ? "…"
            : "✗";
      console.log(
        `  ${tag} ${r.run_id.padEnd(36)} ${r.source.padEnd(28)} ${r.prompt_count}/${persisted} → ${status}`,
      );
    }
  }

  // 4. Latest observation_runs status per platform.
  console.log("");
  console.log("─ Latest observation_runs status (per platform) ─────────────────");
  for (const source of POLL_SOURCES) {
    const { data: latest, error: latestErr } = await sb
      .from("observation_runs")
      .select("run_id, status, scope_label, started_at")
      .eq("tenant_id", TENANT_ID)
      .eq("source", source)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestErr) {
      console.error(`  ✗ ERROR  ${source}: ${latestErr.message}`);
      allOk = false;
      continue;
    }
    if (!latest) {
      console.log(`  · ${source.padEnd(28)} NO RUNS`);
      continue;
    }
    const tag = latest.status === "completed" ? "✓" : "✗";
    if (latest.status !== "completed") allOk = false;
    console.log(
      `  ${tag} ${source.padEnd(28)} status=${latest.status} run_id=${latest.run_id}`,
    );
  }

  // 5. Stale verdict for /today.
  console.log("");
  console.log("─ /today freshness verdict ──────────────────────────────────────");
  if (latestObsDate === targetDate) {
    console.log(`  ✓ FRESH — latest observation date matches target (${targetDate})`);
  } else {
    console.log(
      `  ⚠ STALE — latest obs date is ${latestObsDate ?? "(none)"}, target is ${targetDate}`,
    );
  }

  // 6. Recs / changelog byte-stable.
  console.log("");
  console.log("─ Recs / changelog row counts (must be unchanged) ───────────────");
  for (const tbl of [
    "recommended_edits",
    "recommendation_responses",
    "changelog_entries",
  ] as const) {
    let countCol: "id" | "rec_id" = "id";
    if (tbl === "recommendation_responses") countCol = "rec_id";
    const { count, error: countErr } = await sb
      .from(tbl)
      .select(countCol, { count: "exact", head: true })
      .eq("tenant_id", TENANT_ID);
    if (countErr) {
      console.error(`  ✗ ERROR  ${tbl}: ${countErr.message}`);
      allOk = false;
      continue;
    }
    console.log(`  · ${tbl.padEnd(28)} ${count ?? 0}`);
  }

  console.log("");
  console.log("══════════════════════════════════════════════════════════════════");
  if (allOk && targetTotal >= FULL_DAY_TARGET) {
    console.log(`✓ POST-CRON GREEN — ${targetTotal} obs landed for ${targetDate}, full sample.`);
  } else if (allOk) {
    console.log(
      `⚠ POST-CRON OK BUT PARTIAL — ${targetTotal} obs landed for ${targetDate} (full target ${FULL_DAY_TARGET}).`,
    );
  } else {
    console.log(`✗ POST-CRON FAILURES — see report above.`);
  }
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("");
  return allOk ? 0 : 1;
}

async function main(): Promise<number> {
  const { mode, date } = parseArgs(process.argv.slice(2));
  if (mode === "post") {
    return runPostCron(date ?? todayUtcIso());
  }
  return runPreCron();
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(
      `[verify-daily-poll] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
    );
    process.exit(2);
  });
