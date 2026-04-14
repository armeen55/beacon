/**
 * Standalone script to build the answer intelligence index from existing data.
 * Run: npx tsx --require ./scripts/mock-server-only.cjs scripts/build-answer-intelligence.ts
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";

import { buildAnswerIntelligenceIndex } from "../src/domains/answer-intelligence/build-index";

const DATA_DIR = join(process.cwd(), ".data");

// Load observations
const obsPath = join(DATA_DIR, "prompt-answer-observations.json");
if (!existsSync(obsPath)) {
  console.error("No prompt-answer-observations.json found");
  process.exit(1);
}
const observations = JSON.parse(readFileSync(obsPath, "utf-8"));
console.log(`Loaded ${observations.length} observations`);

// Load answer texts
const answersPath = join(DATA_DIR, "answer-texts.json");
const answerTexts = existsSync(answersPath)
  ? JSON.parse(readFileSync(answersPath, "utf-8"))
  : {};
console.log(`Loaded ${Object.keys(answerTexts).length} answer texts`);

// Get brand info from env or default
const brandName =
  process.env.BEACON_SITE_ENTITY_NAME ??
  process.env.BEACON_SITE_BRAND_SHORT ??
  "Ritz Builders";
const ownedDomain = (
  process.env.BEACON_SITE_DOMAIN ?? "ritzbuilders.com"
).toLowerCase().replace(/^www\./, "");

console.log(`Brand: ${brandName}, Domain: ${ownedDomain}`);
console.log("Building answer intelligence index...");

const start = Date.now();
const index = buildAnswerIntelligenceIndex({
  observations,
  answerTexts,
  brandName,
  ownedDomain,
});
const elapsed = Date.now() - start;

// Write
const outPath = join(DATA_DIR, "answer-intelligence-index.json");
const tmpPath = outPath + ".tmp";
writeFileSync(tmpPath, JSON.stringify(index, null, 0), "utf-8");
renameSync(tmpPath, outPath);

console.log(`\nDone in ${elapsed}ms`);
console.log(`  Observations: ${index.total_observations}`);
console.log(`  With answer text: ${index.total_with_answer_text}`);
console.log(`  Brand positioning topics: ${index.brand_positioning.length}`);
console.log(`  Visibility cells: ${index.visibility_cells.length}`);
console.log(`  Co-citation competitors: ${index.co_citation.competitors.length}`);
console.log(`  Narrative shifts: ${index.narrative_shifts.length}`);
console.log(`  Topic-platform summaries: ${Object.keys(index.topic_platform_summary).length} topics`);

// Show summary
console.log("\n=== Brand Positioning ===");
for (const bp of index.brand_positioning) {
  console.log(
    `  ${bp.topic}: ${Math.round(bp.mention_rate * 100)}% mention rate, ${bp.brand_descriptors.length} descriptors`,
  );
  for (const d of bp.brand_descriptors.slice(0, 3)) {
    console.log(`    "${d.fragment}" (${d.source_count}x)`);
  }
}

console.log("\n=== Top Competitors by Displacement ===");
const threats = index.co_citation.competitors
  .filter((c) => c.total_answer_appearances >= 50)
  .sort((a, b) => b.displacement_ratio - a.displacement_ratio);
for (const c of threats.slice(0, 10)) {
  console.log(
    `  ${c.domain}: displacement=${Math.round(c.displacement_ratio * 100)}% (${c.total_answer_appearances} appearances)`,
  );
}

console.log("\n=== Recent Narrative Shifts ===");
for (const s of index.narrative_shifts.slice(0, 10)) {
  console.log(`  ${s.to_date} [${s.shift_type}] ${s.detail}`);
}

console.log(`\nOutput: ${outPath} (${Math.round(readFileSync(outPath).length / 1024)}KB)`);
