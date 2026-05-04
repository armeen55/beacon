#!/usr/bin/env tsx
/**
 * Manual poll write-proof (Bug-1 follow-up, 2026-05-04).
 *
 * Operator-approved single controlled manual native poll. Smallest
 * possible scope:
 *   • 1 platform (default: perplexity — cheapest)
 *   • Tiny chunk: limit=5 prompts (vs production's limit=25)
 *   • offset=0
 *   • force=true to bypass the 15-minute retry-dedupe window in case
 *     a previous run today already landed at the same chunk-id.
 *
 * Goal: prove the Bug-1 fixes (dual-write throw + Stage 7 schema
 * migration) actually persist observations end-to-end.
 *
 * Costs at limit=5:
 *   • Perplexity Sonar: ~$0.001 total
 *   • OpenAI GPT-5-mini (chatgpt): ~$0.05–0.15 total
 *
 * Usage:
 *   BEACON_TENANT_ID=tenant-ritz-founder \
 *   BEACON_TENANT_SLUG=ritz-builders \
 *   npx tsx --require ./scripts/mock-server-only.cjs \
 *     scripts/manual-poll-write-proof.ts \
 *     [--platform=perplexity|openai] [--limit=5]
 *
 * After this script lands obs rows, the operator's /today should show:
 *   • new "Last observation" date (today UTC)
 *   • poll banner with status "ok" or "partial" depending on platform
 *   • observationsWritten > 0 (DB truth via the new persistence
 *     cross-check)
 */

// ── Load .env.local BEFORE importing anything that reads process.env ──
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

import { runNativePoll } from "../src/domains/observations/run-poll";
import type { NativePollPlatform } from "../src/domains/observations/run-poll";

type Args = {
  platform: NativePollPlatform;
  limit: number;
  offset: number;
  tenantId: string;
};

function parseArgs(argv: ReadonlyArray<string>): Args {
  let platform: NativePollPlatform = "perplexity";
  let limit = 5;
  let offset = 0;
  for (const arg of argv) {
    if (arg.startsWith("--platform=")) {
      const v = arg.slice("--platform=".length);
      if (v === "perplexity" || v === "openai") platform = v;
    } else if (arg.startsWith("--limit=")) {
      limit = Math.max(1, Math.min(25, parseInt(arg.slice("--limit=".length), 10) || 5));
    } else if (arg.startsWith("--offset=")) {
      offset = Math.max(0, parseInt(arg.slice("--offset=".length), 10) || 0);
    }
  }
  const tenantId = process.env.BEACON_TENANT_ID;
  if (!tenantId) {
    throw new Error("BEACON_TENANT_ID required in env");
  }
  return { platform, limit, offset, tenantId };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log("");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("MANUAL POLL WRITE-PROOF (Bug-1 follow-up)");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`tenant_id : ${args.tenantId}`);
  console.log(`platform  : ${args.platform}`);
  console.log(`offset    : ${args.offset}`);
  console.log(`limit     : ${args.limit} (smallest possible test scope)`);
  console.log(`force     : true (bypass 15-min chunk-retry-dedupe)`);
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("");

  const t0 = Date.now();
  let result;
  try {
    result = await runNativePoll({
      tenantId: args.tenantId,
      platform: args.platform,
      offset: args.offset,
      limit: args.limit,
      force: true,
    });
  } catch (err) {
    const dt = Date.now() - t0;
    console.error("");
    console.error("══════════════════════════════════════════════════════════════════");
    console.error(`✗ POLL THREW after ${dt}ms`);
    console.error("══════════════════════════════════════════════════════════════════");
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      console.error("");
      console.error(err.stack);
    }
    console.error("══════════════════════════════════════════════════════════════════");
    process.exit(2);
  }
  const dt = Date.now() - t0;

  console.log("");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`POLL COMPLETED after ${dt}ms`);
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(JSON.stringify(result, null, 2));
  console.log("══════════════════════════════════════════════════════════════════");

  // Exit code reflects truthful outcome. Operator/CI can gate on it.
  if (result.status === "completed" && result.observationsWritten > 0) {
    process.exit(0);
  }
  if (result.status === "partial") {
    process.exit(3);
  }
  process.exit(4);
}

main().catch((err) => {
  console.error(`[manual-poll-write-proof] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(99);
});
