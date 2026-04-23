/**
 * verify-prompt-decision-matrix — one-shot verification CLI for Phase v5
 * Commit 1 (2026-04-24). Loads live tracked_prompts / tracked_entities /
 * prompt_answer_observations from Supabase, runs the decision-matrix
 * aggregator, prints the group summaries + cluster notes + a few sample
 * classifications. Does NOT write anything — pure read.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/verify-prompt-decision-matrix.ts
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
import { buildPromptDecisionMatrix } from "../src/domains/prompts/decision-matrix";
import type { TrackedPrompt } from "../src/domains/tracked-prompts/types";
import type { TrackedEntity } from "../src/domains/tracked-entities/types";
import type { PromptAnswerObservation } from "../src/domains/prompt-answer-observations/types";

async function pageAll<T>(table: string): Promise<T[]> {
  const sb = getSupabaseAdmin();
  const PAGE = 1000;
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from(table)
      .select("*")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function main() {
  console.log("Loading prompts, entities, observations…");
  const [prompts, entities, observations] = await Promise.all([
    pageAll<TrackedPrompt>("tracked_prompts"),
    pageAll<TrackedEntity>("tracked_entities"),
    pageAll<PromptAnswerObservation>("prompt_answer_observations"),
  ]);
  console.log(
    `  ${prompts.length} prompts (${prompts.filter((p) => p.is_active).length} active) · ${entities.length} entities · ${observations.length} observations`,
  );

  const matrix = buildPromptDecisionMatrix({
    prompts,
    observations,
    activeEntities: entities,
    now: new Date(),
  });

  console.log(
    `\nDecision matrix for ${matrix.date} (lookback from ${matrix.lookbackFrom}):\n`,
  );

  for (const g of matrix.groupSummaries) {
    const note = g.clusterNote ? ` — ${g.clusterNote}` : "";
    console.log(
      `  ${g.category.toUpperCase().padEnd(10, " ")} · ${g.count.toString().padStart(3, " ")} prompts${note}`,
    );
  }

  console.log(`\nClusters detected (${matrix.clusters.length}):`);
  for (const c of matrix.clusters) {
    console.log(
      `  [${c.type}] "${c.label}" · ${c.promptIds.length} prompts · categories=${c.categories.join(",")}`,
    );
  }

  // Sample prompts per category — up to 3 per group, high-signal first.
  console.log("\nSample prompts per category:");
  for (const cat of ["outranked", "absent", "close", "winning", "early"] as const) {
    const inCat = matrix.prompts
      .filter((p) => p.category === cat)
      .sort((a, b) => b.signalStrength - a.signalStrength)
      .slice(0, 3);
    if (inCat.length === 0) continue;
    console.log(`\n  === ${cat.toUpperCase()} ===`);
    for (const p of inCat) {
      const promptText = prompts.find((pr) => pr.id === p.prompt_id)?.text ?? "(unknown)";
      console.log(
        `    [${p.signalStrength.toString().padStart(3, " ")}] ${promptText}`,
      );
      console.log(`         → ${p.reasoning}`);
      if (p.tags.length > 0) console.log(`         tags: ${p.tags.join(", ")}`);
    }
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("Error:", err);
    process.exit(1);
  },
);
