/**
 * Capture before/after attribution score distributions.
 * Run with: npx tsx --require ./scripts/mock-server-only.cjs scripts/score-snapshot.ts
 */
import { readStore } from "../src/lib/persistence/json-store";
import type { Result } from "../src/domains/results/types";
import type { ChangelogEntry } from "../src/domains/changelog/types";
import type { Opportunity } from "../src/domains/opportunities/types";
import { detectOutcomeEvents } from "../src/domains/attribution/events";
import { discoverCandidates } from "../src/domains/attribution/candidates";
import { triageCandidates } from "../src/domains/attribution/triage";
import { partitionResultsByMode } from "../src/domains/attribution/result-mode";
import { classifyEvidenceTier } from "../src/domains/pages/evidence-tier";
import { normalizePageUrl } from "../src/domains/pages/classify";
import type { EvidenceTier, PageEntity } from "../src/domains/pages/types";
import { getSiteConfig } from "../src/lib/site-config";

async function main() {
  const siteDomain = getSiteConfig().siteDomain;
  const results = readStore<Result>("imported-results");
  const changes = readStore<ChangelogEntry>("imported-changes");
  const opps = readStore<Opportunity>("imported-opportunities");

  const pages = readStore<PageEntity>("pages");
  const pageRegistry = new Map(pages.map((p) => [p.url, p]));

  // Load citation evidence page_to_topics index
  const fs = require("node:fs");
  const path = require("node:path");
  const ceiPath = path.join(process.cwd(), ".data", "citation-evidence-index.json");
  let citationTopicIndex = new Map<string, Set<string>>();
  if (fs.existsSync(ceiPath)) {
    const raw = JSON.parse(fs.readFileSync(ceiPath, "utf-8"));
    const ptMap: Record<string, string[]> = raw.page_to_topics ?? {};
    citationTopicIndex = new Map(
      Object.entries(ptMap).map(([url, topics]: [string, string[]]) => [url, new Set(topics)])
    );
  }
  console.log(`Results: ${results.length}, Changes: ${changes.length}, Opps: ${opps.length}, Pages: ${pages.length}, Citation page-topics: ${citationTopicIndex.size}`);

  // Evidence tier distribution across all changes
  const tierCounts: Record<string, number> = { exact: 0, probable: 0, weak: 0, inferred: 0 };
  for (const c of changes) {
    const meta = classifyEvidenceTier(c, pageRegistry);
    tierCounts[meta.tier]++;
  }
  console.log(`\nEvidence tier distribution (${changes.length} changes):`);
  for (const [tier, count] of Object.entries(tierCounts)) {
    console.log(`  ${tier}: ${count} (${pct(count, changes.length)}%)`);
  }

  const { attribution } = partitionResultsByMode(results);
  const events = detectOutcomeEvents(attribution);
  console.log(`\nEvents detected: ${events.length}`);
  console.log(`  first_appearance: ${events.filter(e => e.type === "first_appearance").length}`);
  console.log(`  visibility_regained: ${events.filter(e => e.type === "visibility_regained").length}`);
  console.log(`  mention_surge: ${events.filter(e => e.type === "mention_surge").length}`);

  let totalCandidates = 0;
  let autoResolved = 0;
  let needsReview = 0;
  const allScores: number[] = [];
  const factorCounts: Record<string, Record<string, number>> = {};
  const evidenceTierInCandidates: Record<string, number> = { exact: 0, probable: 0, weak: 0, inferred: 0, null: 0 };
  const candidatesPerEvent: number[] = [];
  const strongest: { score: number; topic: string; change: string; matches: Record<string, string>; tier: string | null }[] = [];
  let totalSuppressed = 0;
  let totalPrimary = 0;
  let totalContributing = 0;
  let totalNeedsReviewCandidates = 0;
  let topicMatchingCandidates = 0;
  let noTopicCandidates = 0;
  let citationSupportedCandidates = 0;
  let citationSupportedNoTopic = 0;

  for (const event of events) {
    const result = results.find(r => r.id === event.anchor_result_id);
    if (!result) continue;

    const candidates = discoverCandidates(result, changes, opps);
    totalCandidates += candidates.length;
    candidatesPerEvent.push(candidates.length);

    for (const c of candidates) {
      allScores.push(c.score);
      const tier = c.attribution.evidence_tier;
      evidenceTierInCandidates[tier ?? "null"]++;

      const hasTopic = c.attribution.matches.topic === "strong" || c.attribution.matches.topic === "partial";
      if (hasTopic) {
        topicMatchingCandidates++;
      } else {
        noTopicCandidates++;
      }

      // Check citation support
      if (c.change.url && result.topic) {
        const parsed = normalizePageUrl(c.change.url, siteDomain);
        if (parsed) {
          const topics = citationTopicIndex.get(parsed.url);
          if (topics?.has(result.topic)) {
            citationSupportedCandidates++;
            if (!hasTopic) citationSupportedNoTopic++;
          }
        }
      }

      for (const [factor, strength] of Object.entries(c.attribution.matches)) {
        if (!factorCounts[factor]) factorCounts[factor] = { strong: 0, partial: 0, none: 0, unknown: 0 };
        factorCounts[factor][strength as string]++;
      }
      strongest.push({
        score: c.score,
        topic: result.topic ?? "?",
        change: c.change.change_description?.slice(0, 50) ?? c.change.asset_name?.slice(0, 50) ?? "?",
        matches: c.attribution.matches as unknown as Record<string, string>,
        tier: tier ?? null,
      });
    }

    const triage = triageCandidates(candidates);
    if (triage.autoResolved) autoResolved++;
    else needsReview++;
    if (triage.primary) totalPrimary++;
    totalContributing += triage.contributing.length;
    totalNeedsReviewCandidates += triage.needsReview.length;
    totalSuppressed += triage.suppressed.length;
  }

  strongest.sort((a, b) => b.score - a.score);
  const top5 = strongest.slice(0, 5);
  const bottom5 = strongest.slice(-5).reverse();

  console.log(`\nTotal candidates across all events: ${totalCandidates}`);
  console.log(`  Topic-matching: ${topicMatchingCandidates} (${pct(topicMatchingCandidates, totalCandidates)}%)`);
  console.log(`  No-topic: ${noTopicCandidates} (${pct(noTopicCandidates, totalCandidates)}%)`);
  console.log(`  Citation-supported: ${citationSupportedCandidates} (${pct(citationSupportedCandidates, totalCandidates)}%)`);
  console.log(`  Citation-supported + no-topic: ${citationSupportedNoTopic} (changes that target cited pages but have vague descriptions)`);
  console.log(`Auto-resolved events: ${autoResolved}`);
  console.log(`Needs-review events: ${needsReview}`);
  console.log(`Avg candidates/event: ${events.length > 0 ? (totalCandidates / events.length).toFixed(2) : 0}`);

  console.log(`\nTriage breakdown (across ${events.length} events):`);
  console.log(`  Primary assigned: ${totalPrimary}`);
  console.log(`  Contributing: ${totalContributing}`);
  console.log(`  Needs review (candidates): ${totalNeedsReviewCandidates}`);
  console.log(`  Suppressed: ${totalSuppressed}`);

  // Candidate distribution
  const dist = { "0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5+": 0 };
  for (const count of candidatesPerEvent) {
    if (count === 0) dist["0"]++;
    else if (count === 1) dist["1"]++;
    else if (count === 2) dist["2"]++;
    else if (count === 3) dist["3"]++;
    else if (count === 4) dist["4"]++;
    else dist["5+"]++;
  }
  console.log(`\nCandidates-per-event distribution:`);
  for (const [bucket, count] of Object.entries(dist)) {
    console.log(`  ${bucket}: ${count} events`);
  }

  if (allScores.length > 0) {
    allScores.sort((a, b) => a - b);
    console.log(`\nScore distribution:`);
    console.log(`  Min: ${allScores[0]}`);
    console.log(`  Q25: ${allScores[Math.floor(allScores.length * 0.25)]}`);
    console.log(`  Median: ${allScores[Math.floor(allScores.length * 0.5)]}`);
    console.log(`  Q75: ${allScores[Math.floor(allScores.length * 0.75)]}`);
    console.log(`  Max: ${allScores[allScores.length - 1]}`);
    console.log(`  Mean: ${(allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(1)}`);
  }

  console.log(`\nEvidence tier in surviving candidates:`);
  for (const [tier, count] of Object.entries(evidenceTierInCandidates)) {
    if (count > 0) console.log(`  ${tier}: ${count} (${pct(count, totalCandidates)}%)`);
  }

  console.log(`\nFactor hit rates (across ${allScores.length} candidates):`);
  for (const [factor, counts] of Object.entries(factorCounts)) {
    const total = counts.strong + counts.partial + counts.none + counts.unknown;
    console.log(`  ${factor}: strong=${counts.strong} (${pct(counts.strong, total)}%), partial=${counts.partial} (${pct(counts.partial, total)}%), none=${counts.none} (${pct(counts.none, total)}%), unknown=${counts.unknown} (${pct(counts.unknown, total)}%)`);
  }

  console.log(`\n5 STRONGEST candidates:`);
  for (const c of top5) {
    console.log(`  Score ${c.score} | ${c.topic} | ${c.change}`);
    console.log(`    matches: ${JSON.stringify(c.matches)}`);
    console.log(`    evidence_tier: ${c.tier}`);
  }

  console.log(`\n5 WEAKEST candidates:`);
  for (const c of bottom5) {
    console.log(`  Score ${c.score} | ${c.topic} | ${c.change}`);
    console.log(`    matches: ${JSON.stringify(c.matches)}`);
    console.log(`    evidence_tier: ${c.tier}`);
  }
}

function pct(n: number, total: number): string {
  return total > 0 ? Math.round((n / total) * 100).toString() : "0";
}

main().catch(console.error);
