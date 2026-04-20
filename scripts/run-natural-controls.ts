/**
 * Phase 2B runner — execute the natural-controls attribution engine over every
 * classified historical event and persist results.
 *
 * Inputs:
 *   .data/classified-events.json              (from classify-historical-changes.ts)
 *   .data/citations-by-date/*.json            (Profound citation shards)
 *   .data/prompt-answer-observations.json     (for platform join via url-citation-history)
 *
 * Outputs:
 *   .data/natural-control-results.json        (one NaturalControlResult per event)
 *   .data/natural-control-summary.json        (aggregate stats + per-bucket rollups)
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/run-natural-controls.ts
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/run-natural-controls.ts --dry-run
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/run-natural-controls.ts --show-examples
 *
 * Undo:
 *   rm .data/natural-control-results.json .data/natural-control-summary.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CLASSIFIER_VERSION,
  inferUrlType as inferUrlTypeFromTaxonomy,
  type ClassifiedEvent,
} from "../src/domains/attribution/change-taxonomy";
import {
  attributeAll,
  DEFAULT_CONFIG,
  summarize,
  type NaturalControlResult,
} from "../src/domains/attribution/natural-controls";
import {
  fromNaturalControlResult,
  buildOutcomeSummaryIndex,
  validateInvariants,
  type StoredChangeOutcome,
} from "../src/domains/attribution/change-outcome-store";
import { buildUrlCitationHistory } from "../src/domains/product/url-citation-history";

const ROOT = resolve(__dirname, "..");
const EVENTS_PATH = resolve(ROOT, ".data/classified-events.json");
const OUT_RESULTS = resolve(ROOT, ".data/natural-control-results.json");
const OUT_SUMMARY = resolve(ROOT, ".data/natural-control-summary.json");
const OUT_STORE = resolve(ROOT, ".data/change-outcomes.json");
const OUT_STORE_INDEX = resolve(ROOT, ".data/change-outcomes-summary.json");

const DRY_RUN = process.argv.includes("--dry-run");
const SHOW_EXAMPLES = process.argv.includes("--show-examples");

async function main() {
  console.log("Loading classified events...");
  const events = JSON.parse(readFileSync(EVENTS_PATH, "utf8")) as ClassifiedEvent[];
  console.log(`  ${events.length} events`);

  console.log("Building URL citation history from Profound shards...");
  const history = buildUrlCitationHistory({ ownedOnly: true });
  console.log(`  ${history.distinct_urls} distinct URLs · ${history.date_range.first} → ${history.date_range.last}`);

  console.log("Running attribution engine...");
  const results = attributeAll(events, history, inferUrlTypeFromTaxonomy, CLASSIFIER_VERSION, DEFAULT_CONFIG);
  const summary = summarize(results);

  // Build the durable store layer (Phase 2C)
  console.log("Building change-outcome store...");
  const stored: StoredChangeOutcome[] = results.map((r) => {
    const s = fromNaturalControlResult(r, history);
    validateInvariants(s); // throws on structural violations before persistence
    return s;
  });
  const storeIndex = buildOutcomeSummaryIndex(stored);

  if (!DRY_RUN) {
    writeFileSync(OUT_RESULTS, JSON.stringify(results, null, 2));
    writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2));
    writeFileSync(OUT_STORE, JSON.stringify(stored, null, 2));
    writeFileSync(OUT_STORE_INDEX, JSON.stringify(storeIndex, null, 2));
    console.log(`\nWrote ${OUT_RESULTS} (${results.length} engine results)`);
    console.log(`Wrote ${OUT_SUMMARY}`);
    console.log(`Wrote ${OUT_STORE} (${stored.length} stored outcomes)`);
    console.log(`Wrote ${OUT_STORE_INDEX}`);
  } else {
    console.log("\n(dry run — no files written)");
  }

  console.log("\n=== STATUS TOTALS ===");
  for (const [k, v] of Object.entries(summary.by_status)) console.log(`  ${k.padEnd(26)} ${v}`);
  console.log("\n=== CONFIDENCE TOTALS ===");
  for (const [k, v] of Object.entries(summary.by_confidence)) console.log(`  ${k.padEnd(26)} ${v}`);
  console.log("\n=== LIFT DISTRIBUTION (computed + weak_estimate) ===");
  console.log(`  positive (adj_lift > 0.05):  ${summary.computed_lift_distribution.positive_events}`);
  console.log(`  negative (adj_lift < -0.05): ${summary.computed_lift_distribution.negative_events}`);
  console.log(`  near-zero:                   ${summary.computed_lift_distribution.near_zero_events}`);
  console.log(`  mean adjusted_lift:          ${summary.computed_lift_distribution.mean_adjusted_lift}`);
  console.log(`  median adjusted_lift:        ${summary.computed_lift_distribution.median_adjusted_lift}`);

  console.log("\n=== TOP 10 BUCKETS BY EVENT COUNT ===");
  for (const row of summary.by_primary_bucket.slice(0, 10)) {
    const lift = row.mean_adjusted_lift === null ? "-" : String(row.mean_adjusted_lift);
    const rel = row.mean_relative_lift === null ? "-" : `${((row.mean_relative_lift ?? 0) * 100).toFixed(0)}%`;
    console.log(`  ${row.bucket.padEnd(44)} n=${row.n}  computed=${row.computed}  mean_lift=${lift}  mean_rel=${rel}`);
  }

  if (SHOW_EXAMPLES) {
    printExamples(results);
  }
}

function printExamples(results: NaturalControlResult[]) {
  console.log("\n=== CANONICAL EXAMPLES ===");

  const computed = results.filter((r) => r.status === "computed");
  const weak = results.filter((r) => r.status === "weak_estimate");
  const overlaps = results.filter(
    (r) => r.warnings.some((w) => w.includes("self_overlap") || w.includes("post_overlap")),
  );
  const bundles = results.filter((r) => r.status === "computed" && r.child_tags.length > 0);
  const unsupported = results.filter((r) => r.status === "unsupported_scope");
  const ineligible = results.filter((r) => r.status === "ineligible_layer" || r.status === "ineligible_event");

  const strong = [...computed]
    .filter((r) => r.confidence === "high" && Math.abs(r.overall?.adjusted_lift ?? 0) > 0.1)
    .sort((a, b) => Math.abs(b.overall!.adjusted_lift) - Math.abs(a.overall!.adjusted_lift))[0];

  const noisy = [...computed]
    .filter((r) => r.confidence !== "high")
    .sort((a, b) => (a.matched_control_count - b.matched_control_count))[0]
    ?? weak[0];

  printExample("STRONG (high confidence, non-trivial lift)", strong);
  printExample("NOISY/WEAK (low controls or low baseline)", noisy);
  printExample("BUNDLE (parent with child_tags)", bundles[0]);
  printExample("OVERLAP EXCLUSION (self or post overlap flagged)", overlaps[0]);
  printExample("UNSUPPORTED SCOPE (sitewide / infra / offsite etc.)", unsupported[0]);
  printExample("INELIGIBLE (non-change layer)", ineligible[0]);
}

function printExample(title: string, r: NaturalControlResult | undefined) {
  console.log(`\n--- ${title} ---`);
  if (!r) {
    console.log("  (no matching example found)");
    return;
  }
  console.log(`  event_id:       ${r.event_id}`);
  console.log(`  primary_bucket: ${r.primary_bucket}`);
  if (r.child_tags.length > 0) console.log(`  child_tags:     [${r.child_tags.join(", ")}]`);
  if (r.paired_with.length > 0) console.log(`  paired_with:    [${r.paired_with.join(", ")}]`);
  console.log(`  url:            ${r.url ?? "(none)"}  (type=${r.url_type ?? "?"})`);
  console.log(`  treatment_date: ${r.treatment_date}`);
  if (r.pre_window) console.log(`  pre_window:     ${r.pre_window.start} → ${r.pre_window.end}`);
  if (r.post_window) console.log(`  post_window:    ${r.post_window.start} → ${r.post_window.end}`);
  console.log(`  status:         ${r.status}  confidence=${r.confidence}`);
  console.log(`  controls:       matched=${r.matched_control_count}  excluded=${r.excluded_control_count}`);
  if (Object.keys(r.excluded_reasons).length > 0) {
    console.log(`  excl_reasons:   ${JSON.stringify(r.excluded_reasons)}`);
  }
  if (r.overall) {
    const o = r.overall;
    console.log(
      `  overall lift:   treated_delta=${o.treated_delta}  control_delta=${o.control_delta}  adjusted=${o.adjusted_lift}  rel=${o.relative_lift === null ? "null" : (o.relative_lift * 100).toFixed(0) + "%"}`,
    );
    console.log(`                  treated_pre=${o.treated_pre_avg}  treated_post=${o.treated_post_avg}  controls_used=${o.controls_used}  pre_days_obs=${o.pre_days_observed}  post_days_obs=${o.post_days_observed}`);
  }
  if (r.per_platform.length > 0) {
    console.log(`  per_platform:`);
    for (const p of r.per_platform) {
      console.log(`    ${p.platform.padEnd(22)} adj=${p.adjusted_lift}  rel=${p.relative_lift === null ? "null" : (p.relative_lift * 100).toFixed(0) + "%"}  treated_Δ=${p.treated_delta}  control_Δ=${p.control_delta}`);
    }
  }
  if (r.warnings.length > 0) console.log(`  warnings:       ${r.warnings.join("\n                  ")}`);
  console.log(`  rationale:      ${r.rationale}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
