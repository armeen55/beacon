/**
 * canary-persistence-write — Persistence-end-to-end canary (Operator R5).
 *
 * Poll Integrity Hardening (2026-05-04, post May 2-4 incident).
 *
 * The classic poll canary at `scripts/check-yesterday-poll.ts` only reads
 * `observation_runs` and exits non-zero if the run-level summary is bad.
 * That misses the failure mode where a run reports `status: completed`
 * but the actual obs upsert silently failed (the May 2-4 incident).
 *
 * This canary takes the next defensive step: it WRITES through the
 * full persistence pipeline using a mock provider result, verifies the
 * rows landed, then cleans up after itself. If the schema cache drifts
 * again, this canary fails LOUD before paid polling runs the next morning.
 *
 *   1. Build a mock observation row carrying the full Schema v2.1
 *      column set (including `competitor_descriptor_windows`) — the
 *      shape the production poll adapters write.
 *   2. Upsert via `syncPromptAnswerObservations` (real dual-write path).
 *   3. Read the row back from Supabase to verify it landed.
 *   4. Build a mock daily snapshot that joins to the canary observation.
 *   5. Upsert via `syncDailyMetricSnapshots`.
 *   6. Read the snapshot back to verify.
 *   7. Delete both canary rows so they don't pollute production metrics.
 *      (The canary observation/snapshot id starts with `canary-` and
 *      the obs row carries `metadata.canary: true`, so any read path
 *      that wants to be paranoid can also filter at query time.)
 *
 * Exit codes:
 *   0  → all writes + reads + cleanups succeeded
 *   1  → write or read verification failed (real persistence failure)
 *   2  → cleanup failed (rows landed but couldn't be removed — operator
 *        must manually purge the canary row)
 *
 * Required env (same as the existing canary):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   DUAL_WRITE=true
 *   BEACON_TENANT_ID  (defaults to tenant-ritz-founder)
 *
 * No paid API calls. No provider calls. ZERO cost.
 *
 * Idempotent — re-running upserts the same canary row by deterministic
 * id; cleanup deletes it; next run is fresh.
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

import {
  syncPromptAnswerObservations,
  syncDailyMetricSnapshots,
} from "../src/lib/persistence/dual-write";
import { getSupabaseAdmin } from "../src/lib/persistence/supabase";
import type { PromptAnswerObservation } from "../src/domains/prompt-answer-observations/types";
import type { DailyMetricSnapshot } from "../src/domains/daily-metric-snapshots/types";

const TENANT_ID = process.env.BEACON_TENANT_ID ?? "tenant-ritz-founder";

function buildCanaryObs(now: Date): PromptAnswerObservation {
  // Deterministic id so re-runs upsert the same row + cleanup is targeted.
  const dateKey = now.toISOString().slice(0, 10);
  const id = `canary-persistence-write-${dateKey}-${TENANT_ID}`;
  return {
    id,
    prompt_id: "canary-prompt-id",
    run_id: `canary-run-${dateKey}`,
    answer_hash: "canary-answer-hash",
    position: null,
    tracked_brand_mentioned: false,
    tracked_brand_cited: false,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: [],
    observed_at: now.toISOString(),
    platform: "canary",
    topic: "canary",
    metadata: {
      // Schema v2 fields the production polls write — keeping the
      // shape complete so this canary catches column-drift on ANY of
      // these (the May 2-4 incident class).
      canary: true,
      run_id: `canary-run-${dateKey}`,
      extracted: {
        searchQueries: [],
        openPageUrls: [],
        refusalText: null,
      },
      provider: {
        systemFingerprint: null,
        serviceTier: null,
        finishReason: null,
      },
      providerRaw: null,
      failure: null,
      blindSpot: null,
    } as Record<string, unknown>,
    tenant_id: TENANT_ID,
    mention_position: null,
    citation_rank: null,
    primary_recommendation: false,
    descriptor_window: undefined,
    competitor_co_mentions: undefined,
    // The Schema v2.1 field that caused the May 2-4 incident. Always
    // include it on canary writes so future column-drift FAILS LOUD here.
    competitor_descriptor_windows: { canary: ["test"] },
    citation_domain_classes: undefined,
    answer_structure: undefined,
    citation_urls: undefined,
    search_queries: undefined,
  };
}

function buildCanarySnapshot(now: Date): DailyMetricSnapshot {
  const dateKey = now.toISOString().slice(0, 10);
  const id = `canary-snap-${dateKey}-${TENANT_ID}`;
  return {
    id,
    date: dateKey,
    scope_type: "platform",
    scope_id: "canary",
    platform: "canary",
    source_type: "derived",
    visibility_score: null,
    mention_count: 0,
    citation_count: 0,
    share_of_voice: null,
    avg_position: null,
    total_possible: null,
    metadata: {
      canary: true,
      derived_at: now.toISOString(),
    } as Record<string, unknown>,
    tenant_id: TENANT_ID,
  };
}

async function main(): Promise<number> {
  const now = new Date();
  const obs = buildCanaryObs(now);
  const snap = buildCanarySnapshot(now);
  const sb = getSupabaseAdmin();

  console.log(
    `[canary-persistence] Starting at ${now.toISOString()} for tenant ${TENANT_ID}`,
  );

  // Step 1: write canary observation through the production dual-write
  // path. If schema/column drift exists, this throws (Bug-1 fix).
  try {
    await syncPromptAnswerObservations([obs], TENANT_ID);
  } catch (err) {
    console.error(
      `[canary-persistence] FAIL: syncPromptAnswerObservations threw — ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }

  // Step 2: read the row back to verify it actually landed.
  try {
    const { data, error } = await sb
      .from("prompt_answer_observations")
      .select("id")
      .eq("id", obs.id)
      .eq("tenant_id", TENANT_ID)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      console.error(
        `[canary-persistence] FAIL: observation upsert succeeded silently but row not in Supabase (id=${obs.id})`,
      );
      return 1;
    }
  } catch (err) {
    console.error(
      `[canary-persistence] FAIL: observation read-back error — ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }

  // Step 3: write a canary snapshot.
  try {
    await syncDailyMetricSnapshots([snap], TENANT_ID);
  } catch (err) {
    console.error(
      `[canary-persistence] FAIL: syncDailyMetricSnapshots threw — ${err instanceof Error ? err.message : String(err)}`,
    );
    // Still try to clean up the obs row that landed in step 1.
    await tryDeleteRow("prompt_answer_observations", obs.id);
    return 1;
  }

  // Step 4: read the snapshot back.
  try {
    const { data, error } = await sb
      .from("daily_metric_snapshots")
      .select("id")
      .eq("id", snap.id)
      .eq("tenant_id", TENANT_ID)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      console.error(
        `[canary-persistence] FAIL: snapshot upsert succeeded silently but row not in Supabase (id=${snap.id})`,
      );
      // Still cleanup the obs row.
      await tryDeleteRow("prompt_answer_observations", obs.id);
      return 1;
    }
  } catch (err) {
    console.error(
      `[canary-persistence] FAIL: snapshot read-back error — ${err instanceof Error ? err.message : String(err)}`,
    );
    await tryDeleteRow("prompt_answer_observations", obs.id);
    return 1;
  }

  // Step 5: cleanup. Delete both canary rows. If cleanup fails, we still
  // exit 2 (canary functionality worked but operator must manually purge).
  let cleanupOk = true;
  cleanupOk = (await tryDeleteRow("daily_metric_snapshots", snap.id)) && cleanupOk;
  cleanupOk = (await tryDeleteRow("prompt_answer_observations", obs.id)) && cleanupOk;

  if (!cleanupOk) {
    console.error(
      "[canary-persistence] WARN: writes + reads succeeded but cleanup failed. Operator should DELETE rows by id from Supabase Studio. Exit code 2.",
    );
    return 2;
  }

  console.log(
    `[canary-persistence] OK — observation + snapshot wrote, read back, cleaned up. Schema v2.1 + dual-write pipeline VERIFIED HEALTHY.`,
  );
  return 0;
}

async function tryDeleteRow(
  table: "prompt_answer_observations" | "daily_metric_snapshots",
  id: string,
): Promise<boolean> {
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb
      .from(table)
      .delete()
      .eq("id", id)
      .eq("tenant_id", TENANT_ID);
    if (error) {
      console.error(
        `[canary-persistence] cleanup ${table}/${id} failed — ${error.message ?? String(error)}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `[canary-persistence] cleanup ${table}/${id} threw — ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(
      `[canary-persistence] uncaught error — ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
    );
    process.exit(2);
  });
