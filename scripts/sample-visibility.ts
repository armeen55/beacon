/**
 * sample-visibility — Native AI answer sampling via Perplexity.
 *
 * Loads active prompts from the prompt library (initializing from Profound
 * tracked prompts if the library is empty), calls Perplexity for each,
 * and stores full answer snapshots.
 *
 * Usage:
 *   npm run data:sample                      # sample all active prompts
 *   npm run data:sample -- --limit 5         # sample first 5 only
 *   npm run data:sample -- --dry-run         # preview prompts, no API calls
 *
 * Requires PERPLEXITY_API_KEY in .env.local.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createPerplexityClient } from "../src/lib/querying/perplexity-client";
import {
  getActivePrompts,
  initFromTrackedPrompts,
  persistPromptLibrary,
  getLibrarySummary,
} from "../src/domains/prompts/prompt-library";
import {
  appendSnapshot,
  persistAnswerSnapshots,
} from "../src/domains/answer-snapshots/store";
import type { AnswerSnapshot } from "../src/domains/answer-snapshots/types";

// ── Load .env.local ──
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

// ── CLI args ──
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 && args[limitIdx + 1]
  ? parseInt(args[limitIdx + 1], 10)
  : Infinity;

const DELAY_MS = 1200;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("─── Beacon visibility sampling ───\n");

  // ── Step 1: ensure prompt library is populated ──
  let libSummary = await getLibrarySummary();
  if (libSummary.total === 0) {
    console.log("Prompt library empty — seeding from Profound tracked prompts…");
    const tpPath = join(process.cwd(), ".data", "tracked-prompts.json");
    if (existsSync(tpPath)) {
      const raw = JSON.parse(readFileSync(tpPath, "utf-8")) as Array<{
        id: string;
        text: string;
        topic_id: string | null;
        location_scope: string | null;
        service_scope: string | null;
        intent_type: string | null;
        is_active: boolean;
      }>;
      const { added, skipped } = await initFromTrackedPrompts(raw);
      await persistPromptLibrary();
      console.log(`  → Added ${added}, skipped ${skipped} duplicates\n`);
    } else {
      console.log("  → No tracked-prompts.json found. Library remains empty.\n");
    }
    libSummary = await getLibrarySummary();
  }

  console.log(`Prompt library: ${libSummary.total} total, ${libSummary.active} active`);
  const stageBreakdown = Object.entries(libSummary.byJourneyStage)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  if (stageBreakdown) console.log(`  Journey stages: ${stageBreakdown}`);
  console.log();

  // ── Step 2: select prompts to sample ──
  const allActivePrompts = await getActivePrompts();
  const prompts = allActivePrompts.slice(0, isFinite(limit) ? limit : undefined);

  if (prompts.length === 0) {
    console.log("No active prompts to sample. Exiting.");
    return;
  }

  console.log(`Prompts to sample: ${prompts.length}${isFinite(limit) ? ` (limited from ${allActivePrompts.length})` : ""}`);

  if (isDryRun) {
    console.log("\n── DRY RUN — no API calls ──\n");
    for (const p of prompts) {
      console.log(`  [${p.journey_stage}] ${p.prompt_text.slice(0, 80)}${p.prompt_text.length > 80 ? "…" : ""}`);
    }
    console.log(`\n${prompts.length} prompts would be sampled. Exiting dry run.`);
    return;
  }

  // ── Step 3: verify API key ──
  if (!process.env.PERPLEXITY_API_KEY) {
    console.error("ERROR: PERPLEXITY_API_KEY not set in .env.local — cannot sample.");
    process.exit(1);
  }

  // ── Step 4: run sampling ──
  const client = createPerplexityClient("sonar");
  const runId = `run-${Date.now()}`;
  let successCount = 0;
  let errorCount = 0;

  console.log(`\nRun ID: ${runId}`);
  console.log(`Starting sampling at ${new Date().toISOString()}\n`);

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const idx = `[${i + 1}/${prompts.length}]`;

    try {
      const result = await client.sample(prompt.prompt_text);

      const snapshot: AnswerSnapshot = {
        id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        prompt_id: prompt.id,
        prompt_text: prompt.prompt_text,
        platform: client.platform,
        model: result.model,
        answer_text: result.answer_text,
        citations: result.citations,
        entities_mentioned: extractEntities(result.answer_text),
        sampled_at: new Date().toISOString(),
        run_id: runId,
        source_system: "beacon_native",
      };

      appendSnapshot(snapshot);
      successCount++;

      const citCount = result.citations.length;
      console.log(`  ${idx} ✓ ${prompt.prompt_text.slice(0, 60).padEnd(60)} → ${citCount} citations, ${result.answer_text.length} chars`);
    } catch (err) {
      errorCount++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ${idx} ✗ ${prompt.prompt_text.slice(0, 60).padEnd(60)} → ERROR: ${msg.slice(0, 100)}`);
    }

    if (i < prompts.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // ── Step 5: persist ──
  await persistAnswerSnapshots();
  console.log("\n─── Summary ───");
  console.log(`  Run:       ${runId}`);
  console.log(`  Sampled:   ${successCount} / ${prompts.length}`);
  console.log(`  Errors:    ${errorCount}`);
  console.log(`  Stored in: .data/answer-snapshots.json`);
  console.log(`  Completed: ${new Date().toISOString()}`);
}

function extractEntities(text: string): string[] {
  const entities: string[] = [];
  const boldPattern = /\*\*([^*]+)\*\*/g;
  let match;
  while ((match = boldPattern.exec(text)) !== null) {
    const candidate = match[1].trim();
    if (candidate.length > 2 && candidate.length < 80) {
      entities.push(candidate);
    }
  }
  return [...new Set(entities)].slice(0, 50);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
