/**
 * Read-only verification CLI for the Phase v6 Commit 1 recommendation
 * candidate generator. Loads live Supabase data, runs the generator,
 * and prints a compact summary + samples per action-type.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/verify-recommendations-generate.ts
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
import { generateRecommendations } from "../src/domains/recommendations/generate";
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
    `  ${prompts.length} prompts · ${entities.length} entities · ${observations.length} observations`,
  );

  const matrix = buildPromptDecisionMatrix({
    prompts,
    observations,
    activeEntities: entities,
    now: new Date(),
  });

  const recs = generateRecommendations({
    matrix,
    activeEntities: entities,
    trackedPrompts: prompts,
  });

  console.log(`\nGenerated ${recs.length} recommendation candidate(s):`);
  const byType = new Map<string, number>();
  for (const r of recs) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
  for (const [type, count] of byType) {
    console.log(`  ${count.toString().padStart(3, " ")} · ${type}`);
  }

  // Samples per type — up to 2 per type, highest signalStrength first.
  for (const type of [
    "create_cluster_page",
    "create_single",
    "target_competitors",
    "strengthen_page_copy",
    "watch_winning_cluster",
  ] as const) {
    const samples = recs
      .filter((r) => r.type === type)
      .sort((a, b) => b.evidence.maxSignalStrength - a.evidence.maxSignalStrength)
      .slice(0, 2);
    if (samples.length === 0) continue;
    console.log(`\n  === ${type.toUpperCase()} ===`);
    for (const r of samples) {
      console.log(`    [${r.severity}] ${r.title}`);
      console.log(`         key: ${r.stableKey}`);
      console.log(`         ${r.description}`);
      console.log(
        `         ${r.evidence.promptCount} prompts · ${r.evidence.observationCount} observations · effort=${r.effort} · sigMax=${r.evidence.maxSignalStrength}`,
      );
      if (r.evidence.dominantCompetitors.length > 0) {
        console.log(
          `         competitors: ${r.evidence.dominantCompetitors.join(", ")}`,
        );
      }
      if (r.evidence.descriptorsNearBrand.length > 0) {
        console.log(
          `         descriptors: ${r.evidence.descriptorsNearBrand.join(", ")}`,
        );
      }
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
