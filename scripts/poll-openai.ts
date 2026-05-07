/**
 * poll-openai — Native ChatGPT polling via OpenAI Responses API with
 * the built-in `web_search_preview` tool.
 *
 * Reads active tracked prompts + entities for a tenant, calls OpenAI once
 * per prompt via the shared native adapter, and writes results to Supabase
 * through the existing dual-write sync* helpers + derived snapshots pipe.
 *
 * Usage:
 *   npm run data:poll-openai -- --tenant=tenant-ritz-founder --smoke
 *   npm run data:poll-openai -- --tenant=tenant-ritz-founder --smoke --dry-run
 *   npm run data:poll-openai -- --tenant=tenant-ritz-founder --limit=10
 *   npm run data:poll-openai -- --tenant=tenant-ritz-founder --from-run=<runId>
 *
 * Flags:
 *   --smoke        Poll exactly the 10 SMOKE_PROMPT_IDS below (Phase 4 smoke)
 *   --limit=N      Cap to first N eligible prompts (ignored with --smoke)
 *   --dry-run      Preview, no API calls, no writes
 *   --from-run=ID  Re-derive snapshots from an existing ChatGPT run
 *
 * Env required in .env.local:
 *   OPENAI_API_KEY               (poll API — Responses endpoint)
 *   NEXT_PUBLIC_SUPABASE_URL     (Supabase target)
 *   SUPABASE_SERVICE_ROLE_KEY    (Supabase admin writes)
 *   DUAL_WRITE=true              (sync* helpers are no-ops without it)
 *   DATA_SOURCE=supabase         (adapter reads tracked prompts/entities from DB)
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Load .env.local BEFORE importing anything that reads process.env ──
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

import { pollOpenAIForTenant } from "../src/adapters/openai/poll";
import {
  syncPromptAnswerObservations,
  syncAnswerTexts,
  syncObservationRuns,
  syncDailyMetricSnapshots,
  isDualWriteEnabled,
} from "../src/lib/persistence/dual-write";
import { getSupabaseAdmin } from "../src/lib/persistence/supabase";
import { getRepository } from "../src/lib/persistence/repositories";
import { currentTenantId } from "../src/lib/tenant-context";
import { buildDailySnapshotsFromObservations } from "../src/domains/daily-metric-snapshots/build-from-observations";
import type { PromptAnswerObservation } from "../src/domains/prompt-answer-observations/types";
import type { ObservationRun } from "../src/domains/observations/types";

// ──────────────────────────────────────────────────────────────────────
// Phase 4 smoke panel — 10 deliberately chosen prompts.
//
// Balanced across: 5 Perplexity-Apr-22 hits / 5 misses; 3 intent types
// (local_discovery, informational, comparison); 10 different topics;
// 5 different cities for the local_discovery subset.
//
// Purpose: validate that the ChatGPT adapter generalizes cleanly into
// the existing taxonomy without first spending $0.50 on a full run.
// ──────────────────────────────────────────────────────────────────────
const SMOKE_PROMPT_IDS: string[] = [
  // 5 Ritz HITS on Perplexity Apr 22
  "b868010c-e4ec-4d1e-abde-23fd20f29565", // Atherton / local_discovery
  "3a8e18b8-4556-4dca-8caf-604b1777ec8d", // Los Altos / local_discovery
  "7fae8fe4-e8fb-4178-9762-c61e0704de22", // Menlo Park / local_discovery
  "acf7c35a-7a80-42e7-84d8-fc368c8c42d5", // Shield: Luxury / comparison
  "e17d29c3-eab3-4278-a3ea-4bd175692b36", // Best Modern Home Builder / informational
  // 5 Ritz MISSES on Perplexity Apr 22
  "07997bfd-dab1-4916-a502-c7e01f7a3dec", // Palo Alto / local_discovery
  "22276c68-e999-44f9-a29f-002cd142959b", // Cupertino / local_discovery
  "b81a82e1-3e96-4953-8496-0eb708c18514", // Shield: Custom / comparison
  "2ce0f71d-1b16-4804-88f7-b75ea9a7243b", // Already Have Plans / informational
  "15dd7d9b-906e-4be6-a980-691d88c4e447", // Whole Home Renovation / informational
];

// ── CLI args ──
const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const exact = args.indexOf(flag);
  if (exact >= 0) return args[exact + 1];
  const kv = args.find((a) => a.startsWith(`${flag}=`));
  return kv ? kv.slice(flag.length + 1) : undefined;
}

// Sprint 7 Phase 7.5d/2 (2026-04-25) — fail-loud tenant resolution.
// CLI flag `--tenant=<id>` wins; otherwise reads BEACON_TENANT_ID env
// (or throws if unset). No silent ritz fallback.
//
// 2026-05-07 fix: was `await currentTenantId()` but top-level await is
// rejected by esbuild when tsx runs in CJS context (--require shim).
// In CLI mode currentTenantId() resolves to process.env.BEACON_TENANT_ID
// anyway (no request context), so read it directly. Preserves the
// same fail-loud message.
const _rawTenantId: string | undefined = getArg("--tenant") ?? process.env.BEACON_TENANT_ID;
if (!_rawTenantId) {
  throw new Error(
    "currentTenantId: no x-beacon-tenant header and no BEACON_TENANT_ID env var. " +
      "In dev/test set BEACON_TENANT_ID=tenant-ritz-founder or pass --tenant=<id>.",
  );
}
const tenantId: string = _rawTenantId;
const limitRaw = getArg("--limit");
const limit = limitRaw ? Math.max(1, parseInt(limitRaw, 10)) : undefined;
const isDryRun = args.includes("--dry-run");
const isSmoke = args.includes("--smoke");
const fromRunId = getArg("--from-run");
const PLATFORM_LABEL = "ChatGPT";

async function main() {
  console.log("─── Beacon · Native ChatGPT Poll ───\n");

  // Preflight: required env (OPENAI_API_KEY skipped in --from-run or --dry-run modes)
  const missing: string[] = [];
  if (!fromRunId && !isDryRun && !process.env.OPENAI_API_KEY)
    missing.push("OPENAI_API_KEY");
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL)
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) {
    console.error(
      `ERROR: missing env vars in .env.local: ${missing.join(", ")}`,
    );
    process.exit(1);
  }

  if (!isDualWriteEnabled() && !isDryRun) {
    console.error(
      "ERROR: DUAL_WRITE is not enabled. Set DUAL_WRITE=true in .env.local — " +
        "without it, sync* methods are no-ops and no data reaches Supabase.",
    );
    process.exit(1);
  }

  const mode = isDryRun
    ? "DRY RUN (no writes, no API calls)"
    : fromRunId
      ? `BACKFILL (re-derive snapshots from run ${fromRunId} — no OpenAI calls)`
      : isSmoke
        ? `LIVE SMOKE (${SMOKE_PROMPT_IDS.length} deliberate prompts)`
        : "LIVE";
  console.log(`Tenant: ${tenantId}`);
  console.log(
    `Scope:  ${isSmoke ? `smoke (${SMOKE_PROMPT_IDS.length} prompts)` : limit ? `limit=${limit}` : "all active+chatgpt-scoped prompts"}`,
  );
  console.log(`Mode:   ${mode}`);
  console.log();

  // BACKFILL: skip poll, read observations from DB, re-derive snapshots.
  if (fromRunId) {
    await runBackfillMode(fromRunId);
    return;
  }

  // Preload prompts + entities for the smoke filter / dry-run preview.
  const repo = getRepository();
  const [allPrompts, allEntities] = await Promise.all([
    repo.getTrackedPrompts(),
    repo.getTrackedEntities(),
  ]);

  // Resolve the prompts we'll actually poll.
  let promptsToPoll = allPrompts
    .filter((p) => p.is_active)
    .filter(
      (p) => p.platforms.length === 0 || p.platforms.includes("chatgpt"),
    );
  if (isSmoke) {
    const smokeSet = new Set(SMOKE_PROMPT_IDS);
    promptsToPoll = allPrompts.filter((p) => smokeSet.has(p.id));
    if (promptsToPoll.length !== SMOKE_PROMPT_IDS.length) {
      console.warn(
        `WARNING: --smoke expected ${SMOKE_PROMPT_IDS.length} prompts, ` +
          `resolved ${promptsToPoll.length}. Missing IDs:\n  ${SMOKE_PROMPT_IDS.filter(
            (id) => !promptsToPoll.some((p) => p.id === id),
          ).join("\n  ")}`,
      );
    }
  } else if (limit) {
    promptsToPoll = promptsToPoll.slice(0, limit);
  }

  if (isDryRun) {
    console.log(`Would poll ${promptsToPoll.length} prompts.`);
    console.log(
      `Active tracked entities: ${allEntities.filter((e) => e.is_active).length}`,
    );
    console.log(
      `Owned entities:          ${allEntities.filter((e) => e.is_active && e.is_owned).length}`,
    );
    console.log("\nPrompts:");
    promptsToPoll.slice(0, 15).forEach((p, i) => {
      console.log(
        `  ${i + 1}. [${p.intent_type ?? "—"}] [${p.topic_id ?? "—"}]\n     ${p.text.slice(0, 100)}${p.text.length > 100 ? "…" : ""}`,
      );
    });
    if (promptsToPoll.length > 15) {
      console.log(`  … and ${promptsToPoll.length - 15} more`);
    }
    return;
  }

  // Row counts BEFORE
  const sb = getSupabaseAdmin();
  const before = await countsFor(sb, tenantId);
  console.log("Before:");
  console.log(`  prompt_answer_observations (chatgpt): ${before.observations}`);
  console.log(`  observation_runs (total):             ${before.runs}`);
  console.log(`  max observed_at (this tenant):        ${before.maxObservedAt ?? "(none)"}`);
  console.log();

  // Run the poll (pure — no writes yet). Pass pre-filtered prompts so smoke
  // hits exactly the 10 IDs regardless of platforms[] filter behavior.
  const startedAt = Date.now();
  console.log("Polling OpenAI (gpt-4o + web_search_preview)...");
  const result = await pollOpenAIForTenant(tenantId, {
    trackedPrompts: promptsToPoll,
    trackedEntities: allEntities,
  });
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `  Completed in ${elapsedSec}s · ${result.observations.length} observations · ${result.errorCount} errors (run_id=${result.observationRun.run_id})`,
  );
  console.log();

  // Write
  console.log("Writing to Supabase...");
  await syncObservationRuns([result.observationRun], tenantId);
  console.log(`  ✓ observation_runs:           1 row (${result.observationRun.run_id})`);
  await syncPromptAnswerObservations(result.observations, tenantId);
  console.log(`  ✓ prompt_answer_observations: ${result.observations.length} rows`);
  await syncAnswerTexts(result.answerTexts);
  console.log(`  ✓ answer_texts:               ${Object.keys(result.answerTexts).length} rows`);

  const snapshotCount = await deriveAndSyncSnapshots({
    observations: result.observations,
    observationRun: result.observationRun,
  });
  console.log(`  ✓ daily_metric_snapshots:     ${snapshotCount} rows (derived)`);
  console.log();

  // Row counts AFTER
  const after = await countsFor(sb, tenantId);
  const delta = (a: number, b: number) => (a >= b ? `+${a - b}` : `${a - b}`);
  console.log("After:");
  console.log(`  prompt_answer_observations (chatgpt): ${after.observations}  (${delta(after.observations, before.observations)})`);
  console.log(`  observation_runs (total):             ${after.runs}  (${delta(after.runs, before.runs)})`);
  console.log(`  max observed_at (this tenant):        ${after.maxObservedAt ?? "(none)"}`);
  console.log();

  // Cost estimate — gpt-4o + web_search_preview is roughly $0.01–0.015/query
  // depending on answer length. Use 0.012 midpoint for a reasonable estimate.
  const estCost = (result.observations.length * 0.012).toFixed(4);
  console.log(`Estimated cost: ~$${estCost} (gpt-4o + web_search @ ~$0.012/query)`);
  console.log();
  console.log("Done.");
}

async function deriveAndSyncSnapshots(input: {
  observations: PromptAnswerObservation[];
  observationRun: ObservationRun;
}): Promise<number> {
  const trackedEntities = await getRepository().getTrackedEntities();
  const date = input.observationRun.completed_at.slice(0, 10); // YYYY-MM-DD
  const snapshots = buildDailySnapshotsFromObservations({
    tenantId,
    platform: PLATFORM_LABEL,
    observations: input.observations,
    trackedEntities,
    date,
    observationRunId: input.observationRun.run_id,
  });
  await syncDailyMetricSnapshots(snapshots, tenantId);
  return snapshots.length;
}

async function runBackfillMode(runId: string): Promise<void> {
  const sb = getSupabaseAdmin();

  const { data: runRow, error: runErr } = await sb
    .from("observation_runs")
    .select("*")
    .eq("run_id", runId)
    .single();
  if (runErr || !runRow) {
    console.error(
      `ERROR: observation_runs run_id='${runId}' not found.${runErr ? ` ${runErr.message}` : ""}`,
    );
    process.exit(1);
  }

  const { data: obsRows, error: obsErr } = await sb
    .from("prompt_answer_observations")
    .select("*")
    .eq("run_id", runId)
    .eq("tenant_id", tenantId)
    .limit(10000);
  if (obsErr) {
    console.error(`ERROR reading observations: ${obsErr.message}`);
    process.exit(1);
  }
  const observations = (obsRows ?? []) as PromptAnswerObservation[];
  const observationRun: ObservationRun = {
    ...(runRow as Omit<ObservationRun, "tenant_id">),
    tenant_id: tenantId,
  };

  console.log(
    `Loaded run: ${observationRun.run_id}\n` +
      `  observations:  ${observations.length}\n` +
      `  completed_at:  ${observationRun.completed_at}\n` +
      `  status:        ${observationRun.status}\n`,
  );

  if (observations.length === 0) {
    console.error(
      `ERROR: run has 0 observations for tenant '${tenantId}' — nothing to derive.`,
    );
    process.exit(1);
  }

  const beforeCount = await countSnapshotsFor(
    sb,
    observationRun.completed_at.slice(0, 10),
  );
  console.log(
    `Before: daily_metric_snapshots with source_type='derived' for ChatGPT on ${observationRun.completed_at.slice(0, 10)} = ${beforeCount}`,
  );

  const snapshotCount = await deriveAndSyncSnapshots({
    observations,
    observationRun,
  });

  const afterCount = await countSnapshotsFor(
    sb,
    observationRun.completed_at.slice(0, 10),
  );
  console.log(`  ✓ daily_metric_snapshots: ${snapshotCount} rows written`);
  console.log(
    `After:  daily_metric_snapshots with source_type='derived' for ChatGPT on ${observationRun.completed_at.slice(0, 10)} = ${afterCount}`,
  );
  console.log();
  console.log("Done. No OpenAI API calls made. $0 cost.");
}

async function countSnapshotsFor(
  sb: ReturnType<typeof getSupabaseAdmin>,
  date: string,
): Promise<number> {
  const { count } = await sb
    .from("daily_metric_snapshots")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("date", date)
    .eq("source_type", "derived")
    .eq("platform", "ChatGPT");
  return count ?? 0;
}

type CountsSnapshot = {
  observations: number;
  runs: number;
  maxObservedAt: string | null;
};

async function countsFor(
  sb: ReturnType<typeof getSupabaseAdmin>,
  tenantId: string,
): Promise<CountsSnapshot> {
  const [obsRes, runsRes, maxRes] = await Promise.all([
    sb
      .from("prompt_answer_observations")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("platform", "chatgpt"),
    sb.from("observation_runs").select("*", { count: "exact", head: true }),
    sb
      .from("prompt_answer_observations")
      .select("observed_at")
      .eq("tenant_id", tenantId)
      .order("observed_at", { ascending: false })
      .limit(1),
  ]);
  return {
    observations: obsRes.count ?? 0,
    runs: runsRes.count ?? 0,
    maxObservedAt:
      (maxRes.data?.[0] as { observed_at?: string } | undefined)
        ?.observed_at ?? null,
  };
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
