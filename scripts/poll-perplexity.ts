/**
 * poll-perplexity — Native Perplexity polling, end-to-end.
 *
 * Reads active tracked prompts + entities for a tenant, calls Perplexity once
 * per prompt via the pure adapter, and writes results to Supabase through the
 * existing dual-write sync* helpers.
 *
 * Usage:
 *   npm run data:poll-perplexity -- --tenant=tenant-ritz-founder --limit=5
 *   npm run data:poll-perplexity -- --tenant=tenant-ritz-founder
 *   npm run data:poll-perplexity -- --tenant=tenant-ritz-founder --dry-run
 *
 * Env required in .env.local:
 *   PERPLEXITY_API_KEY           (poll API)
 *   NEXT_PUBLIC_SUPABASE_URL     (Supabase target)
 *   SUPABASE_SERVICE_ROLE_KEY    (Supabase admin writes)
 *   DUAL_WRITE=true              (sync* helpers are no-ops without it)
 *   DATA_SOURCE=supabase         (adapter reads tracked prompts/entities from DB)
 *
 * Single-tenant assumption: relies on repository.getTrackedPrompts/Entities
 * returning ALL rows. With Armeen as the only tenant, all rows are his.
 * A future multi-tenant phase will need per-tenant filters in those methods.
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

import { pollPerplexityForTenant } from "../src/adapters/perplexity/poll";
import {
  syncPromptAnswerObservations,
  syncAnswerTexts,
  syncObservationRuns,
  isDualWriteEnabled,
} from "../src/lib/persistence/dual-write";
import { getSupabaseAdmin } from "../src/lib/persistence/supabase";
import { getRepository } from "../src/lib/persistence/repositories";

// ── CLI args ──
const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const exact = args.indexOf(flag);
  if (exact >= 0) return args[exact + 1];
  const kv = args.find((a) => a.startsWith(`${flag}=`));
  return kv ? kv.slice(flag.length + 1) : undefined;
}

const tenantId =
  getArg("--tenant") ??
  process.env.BEACON_TENANT_ID ??
  "tenant-ritz-founder";
const limitRaw = getArg("--limit");
const limit = limitRaw ? Math.max(1, parseInt(limitRaw, 10)) : undefined;
const isDryRun = args.includes("--dry-run");

async function main() {
  console.log("─── Beacon · Native Perplexity Poll ───\n");

  // Preflight: required env
  const missing: string[] = [];
  if (!process.env.PERPLEXITY_API_KEY) missing.push("PERPLEXITY_API_KEY");
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

  // Preflight: DUAL_WRITE must be on, otherwise sync* methods silently no-op
  if (!isDualWriteEnabled() && !isDryRun) {
    console.error(
      "ERROR: DUAL_WRITE is not enabled. Set DUAL_WRITE=true in .env.local — " +
        "without it, sync* methods are no-ops and no data reaches Supabase.",
    );
    process.exit(1);
  }

  console.log(`Tenant: ${tenantId}`);
  console.log(`Limit:  ${limit ?? "none (all active + perplexity-scoped prompts)"}`);
  console.log(`Mode:   ${isDryRun ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log();

  // DRY RUN: preview prompts without calling Perplexity (saves API cost).
  if (isDryRun) {
    const repo = getRepository();
    const [allPrompts, allEntities] = await Promise.all([
      repo.getTrackedPrompts(),
      repo.getTrackedEntities(),
    ]);
    const eligible = allPrompts
      .filter((p) => p.is_active)
      .filter((p) => p.platforms.length === 0 || p.platforms.includes("perplexity"));
    const toPoll = limit ? eligible.slice(0, limit) : eligible;
    console.log("DRY RUN — no API calls, no writes.\n");
    console.log(`Would poll ${toPoll.length} of ${eligible.length} active+perplexity prompts.`);
    console.log(`Active tracked entities: ${allEntities.filter((e) => e.is_active).length}`);
    console.log(`Owned entities:          ${allEntities.filter((e) => e.is_active && e.is_owned).length}`);
    console.log("\nFirst few prompts:");
    toPoll.slice(0, 5).forEach((p, i) => {
      console.log(`  ${i + 1}. [${p.intent_type ?? "—"}] ${p.text.slice(0, 80)}${p.text.length > 80 ? "…" : ""}`);
    });
    return;
  }

  // Row counts BEFORE
  const sb = getSupabaseAdmin();
  const before = await countsFor(sb, tenantId);
  console.log("Before:");
  console.log(`  prompt_answer_observations: ${before.observations}`);
  console.log(`  observation_runs:           ${before.runs}`);
  console.log(`  max observed_at:            ${before.maxObservedAt ?? "(none)"}`);
  console.log();

  // Run the poll (pure — no writes yet)
  const startedAt = Date.now();
  console.log("Polling Perplexity...");
  const result = await pollPerplexityForTenant(tenantId, { limit });
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `  Completed in ${elapsedSec}s · ${result.observations.length} observations · ${result.errorCount} errors (run_id=${result.observationRun.run_id})`,
  );
  console.log();

  // Write
  console.log("Writing to Supabase...");
  await syncObservationRuns([result.observationRun]);
  console.log(`  ✓ observation_runs:           1 row (${result.observationRun.run_id})`);
  await syncPromptAnswerObservations(result.observations);
  console.log(`  ✓ prompt_answer_observations: ${result.observations.length} rows`);
  await syncAnswerTexts(result.answerTexts);
  console.log(`  ✓ answer_texts:               ${Object.keys(result.answerTexts).length} rows`);
  console.log();

  // Row counts AFTER
  const after = await countsFor(sb, tenantId);
  const delta = (a: number, b: number) => (a >= b ? `+${a - b}` : `${a - b}`);
  console.log("After:");
  console.log(`  prompt_answer_observations: ${after.observations}  (${delta(after.observations, before.observations)})`);
  console.log(`  observation_runs:           ${after.runs}  (${delta(after.runs, before.runs)})`);
  console.log(`  max observed_at:            ${after.maxObservedAt ?? "(none)"}`);
  console.log();

  // Cost estimate (Perplexity sonar is roughly $0.005/query as of ~2026)
  const estCost = (result.observations.length * 0.005).toFixed(4);
  console.log(`Estimated cost: ~$${estCost} (Perplexity sonar @ ~$0.005/query)`);
  console.log();
  console.log("Done. Reload /today to verify freshness banner clears.");
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
      .eq("tenant_id", tenantId),
    // observation_runs table has no tenant_id column — count is global.
    // Drift vs the ObservationRun TS type is tracked separately; not in
    // scope for this phase.
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
