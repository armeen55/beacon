/**
 * cron-poll — GitHub Actions cron entry point. Calls runNativePoll
 * directly so polls run on the GitHub runner (no Vercel 300s
 * maxDuration cap).
 *
 * Bundle 2 (2026-05-07) — replaces the Vercel /api/poll/run curl path
 * for SCHEDULED daily polling. The Vercel route stays in place as the
 * manual/debug fallback (operators can still curl it).
 *
 * Both code paths converge at runNativePoll, so persistence semantics,
 * raw_poll_chunks safety net (R3), persistence-gate guard (R6),
 * dual-write (R1), and budget guard are byte-identical between the two.
 *
 * Usage:
 *   npm run cron:poll -- --tenant=tenant-ritz-founder --platform=perplexity
 *   npm run cron:poll -- --tenant=tenant-ritz-founder --platform=openai
 *
 * Optional flags:
 *   --limit=N      cap to first N eligible prompts
 *   --offset=N     skip first N eligible prompts (chunked mode)
 *   --force        bypass the 20-hour budget guard
 *
 * Exit codes:
 *   0   poll completed (status="completed" | "partial" | "skipped_*"
 *       per Operator R6 contract)
 *   1   hard failure (status="failed" or
 *       "skipped_persistence_failure_gate"); GitHub job fails RED
 *   2   bad CLI args
 *
 * Required env (CI sets via repo secrets; .env.local works for dev):
 *   PERPLEXITY_API_KEY    (Perplexity poll only)
 *   OPENAI_API_KEY        (ChatGPT poll only)
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   DUAL_WRITE=true
 *   DATA_SOURCE=supabase
 *   BEACON_TENANT_ID      (or pass via --tenant)
 *
 * Read-only on:
 *   - recommended_edits, recommendation_responses, changelog_entries
 *   (this script does NOT call recommendation LLMs and does NOT mutate
 *   the queue)
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Load .env.local for local dev (CI uses repo secrets via env: block).
const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
  }
}

import { runNativePoll } from "../src/domains/observations/run-poll";

const args = process.argv.slice(2);
function getArg(flag: string): string | undefined {
  const exact = args.indexOf(flag);
  if (exact >= 0) return args[exact + 1];
  const kv = args.find((a) => a.startsWith(`${flag}=`));
  return kv ? kv.slice(flag.length + 1) : undefined;
}

const tenantId = getArg("--tenant") ?? process.env.BEACON_TENANT_ID;
const platformRaw = getArg("--platform");
const platform =
  platformRaw === "perplexity" || platformRaw === "openai" ? platformRaw : null;

if (!tenantId || !platform) {
  console.error(
    "Usage: cron-poll --tenant=<id> --platform=perplexity|openai " +
      "[--limit=N] [--offset=N] [--force]",
  );
  console.error(
    "Required env: PERPLEXITY_API_KEY (or OPENAI_API_KEY), " +
      "NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, " +
      "DUAL_WRITE=true, DATA_SOURCE=supabase",
  );
  process.exit(2);
}

const limitArg = getArg("--limit");
const offsetArg = getArg("--offset");
const limit = limitArg ? Math.max(1, parseInt(limitArg, 10)) : undefined;
const offset = offsetArg ? Math.max(0, parseInt(offsetArg, 10)) : undefined;
const force = args.includes("--force");

const startedAt = Date.now();

(async () => {
  console.log(
    `[cron-poll] tenant=${tenantId} platform=${platform} limit=${limit ?? "all"} offset=${offset ?? 0} force=${force}`,
  );
  // North-star onboarding (2026-06-11): hydrate a self-served tenant's
  // per-tenant business_config row into the config cache before the
  // poll engines resolve config (sync chain still wins for env-blob
  // tenants; placeholder logged honestly).
  {
    const { hydrateBusinessConfigFromSupabase } = await import(
      "../src/lib/business-config"
    );
    const hydrated = await hydrateBusinessConfigFromSupabase(tenantId);
    console.log(
      `[cron-poll] business-config: ${hydrated ? `resolved (${hydrated.domain || "no domain"})` : "PLACEHOLDER — no env/file/db config for this tenant"}`,
    );
  }
  const result = await runNativePoll({
    tenantId,
    platform,
    limit,
    offset,
    force,
  });
  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[cron-poll] DONE tenant=${tenantId} platform=${platform} status=${result.status} elapsedMs=${elapsedMs}`,
  );
  // Print full result so the GitHub Actions log captures the
  // observation_run + persistence-gate + reconciliation details.
  console.log(JSON.stringify(result, null, 2));

  // Hard-fail exit codes — GitHub job turns RED only on these.
  if (
    result.status === "failed" ||
    result.status === "skipped_persistence_failure_gate"
  ) {
    process.exit(1);
  }
  process.exit(0);
})().catch((err) => {
  console.error(
    `[cron-poll] CRASH tenant=${tenantId} platform=${platform}:`,
    err instanceof Error ? err.stack : String(err),
  );
  process.exit(1);
});
