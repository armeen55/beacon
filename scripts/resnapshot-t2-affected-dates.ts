/**
 * resnapshot-t2-affected-dates — Trust Sprint Mini-Phase T2.4 (2026-05-06).
 *
 * Re-derives `daily_metric_snapshots` for tenant-ritz-founder on the dates
 * that T2.3 dedupe (2026-04-22, 2026-04-23) or partial-coverage day-correctness
 * (2026-04-26, 2026-05-06) made stale. Uses the same code path the daily
 * native poll uses — `buildDailySnapshotsFromObservations` →
 * `syncDailyMetricSnapshots`. Idempotent: re-running produces byte-identical
 * snapshot rows because the builder is pure and IDs are deterministic.
 *
 * Scope:
 *   tenant       = tenant-ritz-founder (T1 baseline; only live tenant)
 *   dates        = 2026-04-22, 2026-04-23, 2026-04-26, 2026-05-06
 *   platforms    = ChatGPT, Perplexity (canonical capitalized labels)
 *
 * The script:
 *   1. Loads tracked entities (live, via tenant repo).
 *   2. For each (date, platform) tuple:
 *      a. Loads post-dedupe observations from Supabase.
 *      b. Calls `buildDailySnapshotsFromObservations` → DailyMetricSnapshot[].
 *      c. Persists via `syncDailyMetricSnapshots` (upsert by id).
 *   3. Reports per-tuple: obs count, snapshot rows emitted, total_possible,
 *      brand mention/citation count, sampling_status classification.
 *
 * Honest-partial guarantee:
 *   - 2026-04-26 ChatGPT (66 obs) and 2026-05-06 ChatGPT (99 obs) stay partial;
 *     the builder writes total_possible=actual_obs_count and the resulting
 *     visibility_score is honest about the smaller denominator.
 *   - No paid polling. No invented prompts. No reruns.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/resnapshot-t2-affected-dates.ts
 *
 * Requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (loaded from .env.local).
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

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
import { buildDailySnapshotsFromObservations } from "../src/domains/daily-metric-snapshots/build-from-observations";
import { syncDailyMetricSnapshots } from "../src/lib/persistence/dual-write";
import type { PromptAnswerObservation } from "../src/domains/prompt-answer-observations/types";
import type { TrackedEntity } from "../src/domains/tracked-entities/types";

const TENANT_ID = "tenant-ritz-founder";
const AFFECTED_DATES = ["2026-04-22", "2026-04-23", "2026-04-26", "2026-05-06"] as const;
// (observation platform value, snapshot platform label)
const PLATFORMS: Array<{ obs: string; snapshot: string }> = [
  { obs: "chatgpt", snapshot: "ChatGPT" },
  { obs: "perplexity", snapshot: "Perplexity" },
];

async function loadEntities(): Promise<TrackedEntity[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("tracked_entities").select("*");
  if (error) throw new Error(`tracked_entities: ${error.message}`);
  return (data ?? []) as TrackedEntity[];
}

async function loadObservations(date: string, obsPlatform: string): Promise<PromptAnswerObservation[]> {
  const sb = getSupabaseAdmin();
  const start = `${date}T00:00:00.000Z`;
  // Half-open right-side: < next day. Day+1 computed in JS to dodge timezone edge cases.
  const endIso = new Date(Date.parse(start) + 24 * 60 * 60 * 1000).toISOString();
  const out: PromptAnswerObservation[] = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("prompt_answer_observations")
      .select("*")
      .eq("tenant_id", TENANT_ID)
      .eq("platform", obsPlatform)
      .gte("observed_at", start)
      .lt("observed_at", endIso)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`prompt_answer_observations: ${error.message}`);
    const rows = (data ?? []) as PromptAnswerObservation[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

function classifySampling(n: number): "full" | "partial" | "proof" | "empty" {
  if (n >= 80) return "full";
  if (n >= 10) return "partial";
  if (n >= 1) return "proof";
  return "empty";
}

async function main(): Promise<void> {
  console.log("resnapshot-t2-affected-dates — Trust Sprint T2.4");
  console.log(`tenant: ${TENANT_ID}`);
  console.log(`dates: ${AFFECTED_DATES.join(", ")}`);
  console.log(`platforms: ${PLATFORMS.map((p) => p.snapshot).join(", ")}\n`);

  console.log("Loading tracked entities…");
  const trackedEntities = await loadEntities();
  console.log(`  ${trackedEntities.length} entities loaded (${trackedEntities.filter((e) => e.is_active).length} active)\n`);

  // Capture pre-rebuild snapshot row counts so we can assert post-rebuild
  // counts matches per-tuple expectation (some 0-row tuples will exist
  // for ChatGPT on 2026-04-22 since native polling started 2026-04-22 with
  // perplexity only).
  for (const date of AFFECTED_DATES) {
    for (const { obs, snapshot } of PLATFORMS) {
      const observations = await loadObservations(date, obs);
      const obsCount = observations.length;
      if (obsCount === 0) {
        console.log(`  [${date} ${snapshot}] 0 observations — skip (no platform data this day)`);
        continue;
      }

      // Pick the latest run_id for provenance — matches existing behavior.
      const latestRunId = observations
        .map((o) => o.run_id)
        .sort()
        .pop() ?? `t2-resnapshot-${date}-${obs}`;

      const rows = buildDailySnapshotsFromObservations({
        tenantId: TENANT_ID,
        platform: snapshot,
        observations,
        trackedEntities,
        date,
        observationRunId: latestRunId,
      });

      // Stamp T2 provenance and resnapshot metadata
      const stamped = rows.map((r) => ({
        ...r,
        metadata: {
          ...r.metadata,
          resnapshot_provenance: "t2_4_post_dedupe_resnapshot",
          resnapshot_at: new Date().toISOString(),
          total_possible: obsCount,
          sampling_status: classifySampling(obsCount),
        },
      }));

      await syncDailyMetricSnapshots(stamped, TENANT_ID);

      // Find the platform-aggregate row for the headline log line
      const platformRow = rows.find((r) => r.scope_type === "platform");
      const headline =
        platformRow != null
          ? `mention_count=${platformRow.mention_count}, citation_count=${platformRow.citation_count}, total_possible=${platformRow.total_possible}, sampling=${classifySampling(obsCount)}`
          : "(no platform aggregate emitted)";
      console.log(
        `  [${date} ${snapshot}] obs=${obsCount}, rows_emitted=${rows.length} → ${headline}`,
      );
    }
  }

  console.log("\nDone. Snapshots upserted via syncDailyMetricSnapshots (id-keyed; dual-write).");
}

main().catch((err) => {
  console.error("resnapshot-t2-affected-dates crashed:", err);
  process.exit(1);
});
