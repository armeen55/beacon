/**
 * Ground-truth the N30 question universe against REAL tenant-iranopedia data
 * (2026-07-03, R11) - read-only: builds the universe from live stores WITHOUT
 * persisting, and prints the stats + the exact rows/copy the /prompts
 * "Questions people ask that no one answers well" section would render.
 *
 * Reads (no writes):
 *   - gsc_daily_rows (question-shaped queries + owner pages)
 *   - profound_fanout_rows + native poll expansions (loadFanoutSeedsForTenant)
 *   - tracked_prompts (the tenant question library)
 *   - dataforseo_serp_history (People also ask rows)
 *   - the N2 ownership registry + page_snapshots extracts (coverage)
 *
 * Run (env sourced first so Supabase reads actually work):
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-question-universe.ts
 */

import { buildQuestionUniverseForTenant } from "@/domains/research/question-universe-loader";
import { uncoveredQuestions, describeQuestionSources } from "@/domains/research/question-universe";

const TENANT = process.env.BEACON_TENANT_ID ?? "tenant-iranopedia";

async function main() {
  const u = await buildQuestionUniverseForTenant(TENANT);
  console.log("tenant:", TENANT);
  console.log("stats:", JSON.stringify(u.stats));
  console.log("");
  console.log("== top uncovered (the /prompts section rows) ==");
  for (const r of uncoveredQuestions(u.rows, 5)) {
    console.log("-", r.question);
    console.log("  sources:", r.sources.join(","), "| demand:", r.demandScore, "| coverage:", r.coverageStatus, "| owner:", r.ownership ?? "none");
    console.log("  line:", describeQuestionSources(r));
  }
  console.log("");
  console.log("== sample answered (sunk to the bottom, honestly kept) ==");
  for (const r of u.rows.filter((x) => x.coverageStatus === "answered").slice(0, 3)) {
    console.log("-", r.question, "->", r.ownership, "|", r.coverageDetail);
  }
}

main().catch((e) => {
  console.error("ground-truth failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
