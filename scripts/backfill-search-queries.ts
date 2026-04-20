/**
 * One-shot backfill: elevate `metadata.search_queries` (raw string tucked in
 * the metadata bag by the Profound import adapter) to the first-class fields
 * `raw_search_queries` + parsed `search_queries[]` on PromptAnswerObservation.
 *
 * Built for Phase 7 Part 1b-v2-step1 (2026-04-19). After the type change +
 * ingestion-adapter update, new imports will populate these fields directly.
 * This script brings existing Ritz data forward without requiring a re-import.
 *
 * Safe to re-run (idempotent): recomputes both fields each time from the raw
 * string in metadata.
 *
 * Run: npx tsx scripts/backfill-search-queries.ts
 */

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import { parseSearchQueries } from "@/domains/prompt-answer-observations/search-query-parser";

const STORE_PATH = join(
  process.cwd(),
  ".data",
  "prompt-answer-observations.json",
);

function main(): void {
  console.log("Reading:", STORE_PATH);
  const raw = readFileSync(STORE_PATH, "utf8");
  const obs: PromptAnswerObservation[] = JSON.parse(raw);
  console.log(`  Total observations: ${obs.length}`);

  let hadRawCount = 0;
  let hadParsedCount = 0;
  let populatedAfter = 0;
  let platformBreakdown = new Map<string, number>();

  for (const o of obs) {
    const md = (o.metadata ?? {}) as Record<string, unknown>;
    const rawSQ = typeof md.search_queries === "string" ? md.search_queries : "";

    if (o.raw_search_queries !== undefined) hadRawCount++;
    if (o.search_queries !== undefined) hadParsedCount++;

    // Elevate raw string to first-class field (keep metadata copy intact for
    // backward compat in case any legacy reader still looks there).
    o.raw_search_queries = rawSQ;

    // Re-parse every time \u2014 idempotent.
    o.search_queries = parseSearchQueries(rawSQ);

    if (o.search_queries.length > 0) {
      populatedAfter++;
      const p = o.platform || "?";
      platformBreakdown.set(p, (platformBreakdown.get(p) ?? 0) + 1);
    }
  }

  // Atomic write: tmp + rename
  const tmpPath = STORE_PATH + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(obs, null, 2), "utf8");
  renameSync(tmpPath, STORE_PATH);

  console.log("\nBackfill complete.");
  console.log(`  Had raw_search_queries before: ${hadRawCount}`);
  console.log(`  Had search_queries before: ${hadParsedCount}`);
  console.log(`  Now populated (non-empty search_queries[]): ${populatedAfter}`);
  console.log(`\n  Populated by platform:`);
  const sorted = [...platformBreakdown.entries()].sort((a, b) => b[1] - a[1]);
  for (const [p, c] of sorted) {
    console.log(`    ${p.padEnd(25)}  ${c}`);
  }

  // Sample output
  console.log(`\n  Sample 5 populated observations:`);
  let shown = 0;
  for (const o of obs) {
    if (shown >= 5) break;
    if (!o.search_queries || o.search_queries.length === 0) continue;
    console.log(`    [${o.platform}] ${(o.topic || "").slice(0, 40)}`);
    console.log(`      raw: "${(o.raw_search_queries ?? "").slice(0, 120)}"`);
    console.log(`      parsed: ${JSON.stringify(o.search_queries).slice(0, 200)}`);
    shown++;
  }
}

main();
