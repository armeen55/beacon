/**
 * Phase 2D runner — build the shared-brain from stored change outcomes.
 *
 * Inputs:
 *   .data/change-outcomes.json        (Phase 2C stored outcomes)
 *
 * Outputs:
 *   .data/shared-brain.json           full patterns array
 *   .data/shared-brain-summary.json   summary index
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/build-shared-brain.ts
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/build-shared-brain.ts --dry-run
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/build-shared-brain.ts --show-examples
 *
 * Undo:
 *   rm .data/shared-brain.json .data/shared-brain-summary.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { StoredChangeOutcome } from "../src/domains/attribution/change-outcome-store";
import {
  sanitizeStoredOutcomes,
  type BrainObservation,
} from "../src/domains/attribution/brain-input";
import {
  aggregateBrainPatterns,
  summarizeBrain,
  DEFAULT_CONFIG,
  type BrainPattern,
} from "../src/domains/attribution/shared-brain";

const ROOT = resolve(__dirname, "..");
const OUTCOMES_PATH = resolve(ROOT, ".data/change-outcomes.json");
const OUT_PATTERNS = resolve(ROOT, ".data/shared-brain.json");
const OUT_SUMMARY = resolve(ROOT, ".data/shared-brain-summary.json");

const DRY_RUN = process.argv.includes("--dry-run");
const SHOW_EXAMPLES = process.argv.includes("--show-examples");

/**
 * Single-tenant cohort resolver for now. When multi-tenant ships, this reads
 * from `business-config.json` for each tenant's industry field. The cohort
 * string itself is always broad (e.g. "custom_home_builder") — never a brand.
 */
function resolveCohort(): string | null {
  // Hardcoded for the single Ritz tenant today. Keep broad — NEVER a brand.
  return "custom_home_builder";
}

async function main() {
  console.log("Loading stored change outcomes...");
  const outcomes = JSON.parse(readFileSync(OUTCOMES_PATH, "utf8")) as StoredChangeOutcome[];
  console.log(`  ${outcomes.length} outcomes`);

  console.log("Sanitizing (stripping URLs, source_ids, absolute counts)...");
  const observations: BrainObservation[] = sanitizeStoredOutcomes(outcomes, () => resolveCohort());
  console.log(`  ${observations.length} sanitized observations`);

  console.log("Aggregating patterns (groupByTenantCohort=false, single tenant)...");
  const patterns = aggregateBrainPatterns(observations, DEFAULT_CONFIG);
  const summary = summarizeBrain(observations, patterns);

  if (!DRY_RUN) {
    writeFileSync(OUT_PATTERNS, JSON.stringify(patterns, null, 2));
    writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2));
    console.log(`\nWrote ${OUT_PATTERNS} (${patterns.length} patterns)`);
    console.log(`Wrote ${OUT_SUMMARY}`);
  } else {
    console.log("\n(dry run — no files written)");
  }

  console.log("\n=== SUMMARY ===");
  console.log(`  observations:            ${summary.total_observations}`);
  console.log(`  patterns:                ${summary.total_patterns}`);
  console.log(`  distinct_buckets:        ${summary.distinct_buckets}`);
  console.log(`  distinct_url_types:      ${summary.distinct_url_types}`);
  console.log(`  distinct_cohorts:        ${summary.distinct_cohorts}`);
  console.log("\n=== PATTERNS BY STRENGTH ===");
  for (const [strength, count] of Object.entries(summary.patterns_by_strength)) {
    console.log(`  ${strength.padEnd(22)} ${count}`);
  }

  if (SHOW_EXAMPLES) showExamples(patterns);
}

function showExamples(patterns: BrainPattern[]) {
  console.log("\n=== EXAMPLE PATTERNS ===");

  const pickBy = (strength: string) => patterns.find((p) => p.strength === strength);
  const notEnough = pickBy("not_enough_evidence");
  const weak = pickBy("weak_signal");
  const emerging = pickBy("emerging_signal");
  const strong = pickBy("strong_signal");

  // Also pick one that was SUPPRESSED per platform (i.e. no per_platform entries on a computed pattern)
  const suppressedPerPlatform = patterns.find(
    (p) => p.strength !== "not_enough_evidence" && p.per_platform.length === 0,
  );

  print("NOT_ENOUGH_EVIDENCE (small group)", notEnough);
  print("WEAK_SIGNAL (emerging associations, qualified language)", weak);
  print("EMERGING_SIGNAL (if present)", emerging);
  print("STRONG_SIGNAL (if present)", strong);
  print("SUPPRESSED PER-PLATFORM (low-N platform subpatterns hidden)", suppressedPerPlatform);
}

function print(label: string, p: BrainPattern | undefined) {
  console.log(`\n--- ${label} ---`);
  if (!p) {
    console.log("  (no matching pattern in current dataset)");
    return;
  }
  console.log(`  grouping:           ${JSON.stringify(p.grouping)}`);
  console.log(`  total_n:            ${p.total_n}  (computed_n=${p.computed_n})`);
  console.log(`  strength:           ${p.strength}`);
  console.log(`  cohort_count:       ${p.cohort_count}`);
  console.log(`  status_mix:         ${JSON.stringify(p.status_mix)}`);
  console.log(`  confidence_mix:     ${JSON.stringify(p.confidence_mix)}`);
  if (p.computed_stats) {
    console.log(`  computed_stats:     mean=${p.computed_stats.mean_relative_lift}  median=${p.computed_stats.median_relative_lift}  +/−/0 = ${p.computed_stats.positive_count}/${p.computed_stats.negative_count}/${p.computed_stats.near_zero_count}`);
  } else {
    console.log(`  computed_stats:     (none)`);
  }
  if (Object.keys(p.warning_prevalence).length > 0) {
    console.log(`  warning_prevalence: ${JSON.stringify(p.warning_prevalence)}`);
  }
  if (p.per_platform.length > 0) {
    console.log(`  per_platform:`);
    for (const pp of p.per_platform) {
      const stats = pp.computed_stats
        ? `mean=${pp.computed_stats.mean_relative_lift} median=${pp.computed_stats.median_relative_lift} +/−/0 = ${pp.computed_stats.positive_count}/${pp.computed_stats.negative_count}/${pp.computed_stats.near_zero_count}`
        : "(no computed stats)";
      console.log(`    ${pp.platform.padEnd(22)} n=${pp.computed_n}  ${pp.strength.padEnd(20)} ${stats}`);
    }
  } else {
    console.log(`  per_platform:       (none — all below per-platform weak threshold)`);
  }
  console.log(`  description:`);
  console.log(`    "${p.description}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
