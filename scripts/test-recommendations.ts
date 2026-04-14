/**
 * Quick test: what does the recommendation engine produce with current data?
 * Run: npx tsx scripts/test-recommendations.ts
 *
 * Only tests structural recommendations (no attribution chain needed).
 */

import fs from "fs";
import path from "path";

import type { PageSnapshot, CitationEvidenceIndex, PageEntity } from "../src/domains/pages/types";
import type { AnswerIntelligenceIndex } from "../src/domains/answer-intelligence/types";
import type { ScorecardRowWithImpact } from "../src/domains/attribution/change-impact";
import { computeRecommendations } from "../src/domains/product/recommendation-engine";
import { rankAndSelect } from "../src/domains/product/priority-engine";

const DATA_DIR = path.join(process.cwd(), ".data");

function readJson<T>(name: string): T {
  const filePath = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) return [] as unknown as T;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

const pageSnapshots = readJson<PageSnapshot[]>("page-snapshots");
const citationIndex = readJson<CitationEvidenceIndex>("citation-evidence-index");
const allPages = readJson<PageEntity[]>("pages");
const answerIntelligence = readJson<AnswerIntelligenceIndex>("answer-intelligence-index");

// Build citation count map (owned pages only)
const citMap = new Map<string, number>();
if (citationIndex?.by_page_and_topic) {
  for (const r of citationIndex.by_page_and_topic) {
    if (!r.is_owned) continue;
    const key = r.page_url.replace(/\/+$/, "").toLowerCase();
    citMap.set(key, (citMap.get(key) ?? 0) + r.total_citations);
  }
}

console.log("=== DATA CHECK ===");
console.log("Page snapshots:", pageSnapshots.length);
console.log("Owned pages with citations:", citMap.size);
console.log("All pages (registry):", allPages.length);

console.log("\nTop owned pages by citation count:");
const sortedCit = [...citMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
for (const [url, count] of sortedCit) {
  console.log(`  ${count.toString().padStart(4)} citations — ${url}`);
}

// Empty impact/patterns/briefs — we're testing structural recs only
const emptyImpact: ScorecardRowWithImpact[] = [];

const recs = computeRecommendations({
  impactRows: emptyImpact,
  patterns: [],
  briefs: [],
  pageSnapshots,
  citationCountMap: citMap,
  citationIndex,
  allPages,
  decayResults: [],
  answerIntelligence,
});

console.log(`\n=== RECOMMENDATIONS (${recs.length} total) ===\n`);

for (const rec of recs) {
  console.log(`[${rec.type}] priority=${rec.priority} confidence=${rec.confidence}`);
  console.log(`  HEADLINE: ${rec.headline}`);
  console.log(`  RATIONALE: ${rec.rationale}`);
  console.log(`  TARGET: ${rec.targetPageUrl ?? "(none)"}`);
  console.log(`  CITATIONS: ${rec.citationOpportunity}`);
  if (rec.answerContext) {
    console.log(`  AI CONTEXT: ${rec.answerContext}`);
  }
  console.log();
}

// Priority engine (no patterns/briefs available)
const { primaryAction, secondary } = rankAndSelect({
  recommendations: recs,
  impactRows: emptyImpact,
  patterns: [],
  briefPatternCounts: new Map(),
});

// Test morning brief
import { buildMorningBrief, formatBriefItemForDevs, formatAllBriefsForEmail } from "../src/domains/product/morning-brief";

const brief = buildMorningBrief({
  primaryAction,
  secondaryActions: secondary,
  answerIntelligence,
  citationIndex,
  trendPct: null,
  totalOwnedCitations: [...citMap.values()].reduce((a, b) => a + b, 0),
  latestDataDate: null,
});

console.log("=== MORNING BRIEF ===\n");
console.log(`Total owned citations: ${brief.totalOwnedCitations}`);
console.log(`Items: ${brief.items.length}\n`);

for (const item of brief.items) {
  const label = item.priority === "need" ? "🔴 PRIORITY" : "🔵 SUGGESTED";
  console.log(`${label}: ${item.headline}`);
  console.log(`  Rationale: ${item.rationale}`);
  console.log(`  Page: ${item.pageUrl ?? "(none)"}`);
  console.log(`  Citations: ${item.citationCount} | ${item.confidenceLabel}`);
  console.log(`  Steps:`);
  for (const step of item.steps) {
    console.log(`    - ${step}`);
  }
  if (item.aiContext) {
    console.log(`  AI Context: ${item.aiContext}`);
  }
  console.log();
}

console.log("=== COPY FOR DEVS (Item 1) ===\n");
if (brief.items.length > 0) {
  console.log(formatBriefItemForDevs(brief.items[0]));
}

console.log("\n=== EMAIL FORMAT ===\n");
const email = formatAllBriefsForEmail(brief.items, new Date().toISOString().slice(0, 10));
console.log(`Subject: ${email.subject}`);
console.log(`Body:\n${email.body}`);
