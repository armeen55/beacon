/**
 * Dry-run: run the keyword-gap scanner v3 on Ritz data and report what
 * surfaces at 3 saturation thresholds. Human picks which tuning feels right
 * before we wire the scanner into Today.
 *
 * Run: npx tsx scripts/dry-run-gap-scanner.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  scanKeywordGaps,
  type KeywordGap,
  type SaturationThresholds,
} from "@/domains/product/keyword-gap-scanner";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { PageSnapshot, CitationEvidenceIndex } from "@/domains/pages/types";

const DATA = join(process.cwd(), ".data");

const observations: PromptAnswerObservation[] = JSON.parse(
  readFileSync(join(DATA, "prompt-answer-observations.json"), "utf8"),
);
const answerTexts: Record<string, string> = JSON.parse(
  readFileSync(join(DATA, "answer-texts.json"), "utf8"),
);
const citationIndex: CitationEvidenceIndex = JSON.parse(
  readFileSync(join(DATA, "citation-evidence-index.json"), "utf8"),
);
const pageSnapshots: PageSnapshot[] = JSON.parse(
  readFileSync(join(DATA, "page-snapshots.json"), "utf8"),
);
const businessConfig = JSON.parse(
  readFileSync(join(DATA, "business-config.json"), "utf8"),
);

const citMap = new Map<string, number>();
for (const row of (citationIndex as unknown as { by_page_and_topic?: Array<{ is_owned: boolean; page_url: string; total_citations: number }> }).by_page_and_topic ?? []) {
  if (!row.is_owned) continue;
  const k = row.page_url.replace(/\/+$/, "").toLowerCase();
  citMap.set(k, (citMap.get(k) ?? 0) + (row.total_citations ?? 0));
}

const exps: Array<{ targetPagePath?: string | null; status?: string }> = JSON.parse(
  readFileSync(join(DATA, "experiments.json"), "utf8"),
);
const experimentUrls = new Set(
  exps
    .filter((e) => e.targetPagePath && e.status !== "completed" && e.status !== "cancelled")
    .map((e) => e.targetPagePath!.replace(/\/+$/, "").toLowerCase()),
);

const brandAliases = [businessConfig.name, businessConfig.name?.split(" ")[0]].filter(
  (a: string, i: number, arr: string[]) => a && arr.indexOf(a) === i,
) as string[];

// Dynamic competitor list: top-mentioned entities in observations that aren't
// the brand. businessConfig.primaryCompetitors only has 5 names but the data
// has 30+ competitor brands Ritz didn't explicitly list. Use the top 40 to
// keep search-query noise out of concept extraction.
const brandAliasesLC = new Set<string>(
  (brandAliases as string[]).map((s) => s.toLowerCase()),
);
const mentionCounts = new Map<string, number>();
for (const o of observations) {
  for (const m of o.mentions ?? []) {
    if (!brandAliasesLC.has(m.toLowerCase())) {
      mentionCounts.set(m, (mentionCounts.get(m) ?? 0) + 1);
    }
  }
}
const topMentionedNonBrand = [...mentionCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 40)
  .map(([name]) => name);

const competitorExclusions = Array.from(
  new Set([
    ...(businessConfig.competitors ?? []),
    ...(businessConfig.primaryCompetitors ?? []),
    ...topMentionedNonBrand,
  ]),
);

console.log(`\nDynamic competitor list: ${competitorExclusions.length} names (top: ${competitorExclusions.slice(0, 5).join(", ")}...)`);

// Known city/location labels for the city-name filter. Expand beyond
// businessConfig.locations to include commonly-co-occurring neighbors in the
// Ritz service area (Peninsula cities AI frequently mentions together).
const knownLocations: string[] = [
  ...(businessConfig.locations ?? []),
  "Atherton", "Menlo Park", "Palo Alto", "Los Altos", "Los Altos Hills",
  "Cupertino", "Saratoga", "Portola Valley", "Woodside", "Mountain View",
  "Emerald Hills", "Redwood City", "San Carlos", "Hillsborough",
  "Silicon Valley", "Bay Area", "San Francisco", "Peninsula",
  "California", "CA", "USA",
];

console.log("=".repeat(78));
console.log("DRY-RUN v3 (concept-based): keyword-gap scanner at 3 saturation thresholds");
console.log("=".repeat(78));
console.log(`observations: ${observations.length}, answerTexts keys: ${Object.keys(answerTexts).length}`);
console.log(`pageSnapshots: ${pageSnapshots.length}, citMap size: ${citMap.size}`);
console.log(`brandAliases: ${JSON.stringify(brandAliases)}`);
console.log(`competitorExclusions: ${competitorExclusions.length}`);
console.log(`experimentUrls: ${experimentUrls.size}`);
console.log();

const THRESHOLDS: Array<{ name: string; t: SaturationThresholds }> = [
  { name: "A  (\u226525% saturation, <=50% coverage, \u226515 occurrences)", t: { minSaturationRate: 0.25, maxCoverageRatio: 0.50, minAbsoluteOccurrences: 15 } },
  { name: "B  (\u226515% saturation, <=60% coverage, \u226510 occurrences)", t: { minSaturationRate: 0.15, maxCoverageRatio: 0.60, minAbsoluteOccurrences: 10 } },
  { name: "C  (\u226540% saturation, <=40% coverage, \u226520 occurrences)", t: { minSaturationRate: 0.40, maxCoverageRatio: 0.40, minAbsoluteOccurrences: 20 } },
];

function byKind(gaps: KeywordGap[]): Record<string, KeywordGap[]> {
  const out: Record<string, KeywordGap[]> = { saturation_miss: [], gap: [], positive: [] };
  for (const g of gaps) out[g.kind].push(g);
  return out;
}

function printFinding(f: KeywordGap): void {
  const satPct = (f.evidence.saturation_rate * 100).toFixed(1);
  const covPct = (f.evidence.page_coverage_ratio * 100).toFixed(0);
  console.log(`\n  [${f.kind.toUpperCase()}] ${f.pagePath} \u2014 concept: "${f.concept}" (${f.conceptType}, ${f.confidence})`);
  console.log(`    Score: ${f.impactScore.toFixed(0)}`);
  console.log(`    Saturation: ${satPct}% (${f.evidence.observation_count} of ${f.evidence.topic_cluster_size} observations in topic cluster)`);
  console.log(`    Page coverage: ${covPct}%`);
  console.log(`    Bucket counts: ${f.evidence.competitor_obs_count} competitor-citing, ${f.evidence.own_obs_count} Ritz-citing`);
  console.log(`    Current ${f.targetElement}: "${f.currentHeadingText}"`);
  console.log(`    Why it qualified:`);
  if (f.kind === "saturation_miss") {
    console.log(`      - Appears in ${satPct}% of topic-cluster observations (meets saturation threshold)`);
    console.log(`      - Page covers only ${covPct}% of its content words`);
  } else if (f.kind === "gap") {
    console.log(`      - Competitor-citing answers: ${f.evidence.competitor_obs_count} (\u2265 5)`);
    console.log(`      - Ritz-citing answers: ${f.evidence.own_obs_count} (\u2264 2)`);
  } else {
    console.log(`      - Ritz and competitors both get cited for this concept (hold-ground signal)`);
  }
  console.log(`    Topics: ${f.evidence.topics.slice(0, 2).join("; ")}${f.evidence.topics.length > 2 ? " + " + (f.evidence.topics.length - 2) + " more" : ""}`);
  console.log(`    Example raw queries that contained this concept:`);
  for (const q of f.evidence.example_queries.slice(0, 3)) {
    console.log(`      - "${q.slice(0, 110)}"`);
  }
}

function crossPageRepeats(findings: KeywordGap[]): Array<{ concept: string; pages: string[] }> {
  const byConcept = new Map<string, Set<string>>();
  for (const f of findings) {
    if (!byConcept.has(f.conceptNormalized)) byConcept.set(f.conceptNormalized, new Set());
    byConcept.get(f.conceptNormalized)!.add(f.pagePath);
  }
  return [...byConcept.entries()]
    .filter(([, pages]) => pages.size > 1)
    .map(([concept, pages]) => ({ concept, pages: [...pages] }))
    .sort((a, b) => b.pages.length - a.pages.length);
}

for (const { name, t } of THRESHOLDS) {
  console.log("=".repeat(78));
  console.log(`THRESHOLD ${name}`);
  console.log("=".repeat(78));

  const gaps = scanKeywordGaps({
    pageSnapshots,
    citationCountMap: citMap,
    citationIndex,
    observations,
    answerTexts,
    brandAliases,
    competitorExclusions,
    experimentUrls,
    saturationThresholds: t,
    knownLocations,
  });

  const buckets = byKind(gaps);

  console.log(`\nTotal: ${gaps.length}  |  sat-miss ${buckets.saturation_miss.length}  gap ${buckets.gap.length}  positive ${buckets.positive.length}`);
  const pagesSeen = new Set(gaps.map((g) => g.pagePath));
  console.log(`Pages with any finding: ${pagesSeen.size}`);

  // Cross-page repeat concepts
  const repeats = crossPageRepeats(gaps);
  if (repeats.length > 0) {
    console.log(`\nCross-page repeats (same concept surfacing on multiple pages):`);
    for (const r of repeats.slice(0, 5)) {
      console.log(`  "${r.concept}" on ${r.pages.length} pages: ${r.pages.join(", ")}`);
    }
  } else {
    console.log(`\nAll findings are page-specific (no cross-page repeats).`);
  }

  // Show every saturation miss
  if (buckets.saturation_miss.length > 0) {
    console.log(`\n--- ALL SATURATION MISSES (Tier 1) ---`);
    for (const f of buckets.saturation_miss) printFinding(f);
  } else {
    console.log(`\n(no saturation misses at this threshold)`);
  }

  // Top 5 gaps
  if (buckets.gap.length > 0) {
    console.log(`\n--- TOP 5 COMPETITIVE GAPS (Tier 2) ---`);
    for (const f of buckets.gap.slice(0, 5)) printFinding(f);
  }

  // Top 3 positives
  if (buckets.positive.length > 0) {
    console.log(`\n--- TOP 3 POSITIVES (Tier 3 \u2014 computed, not surfaced) ---`);
    for (const f of buckets.positive.slice(0, 3)) printFinding(f);
  }

  console.log();
}
