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

async function main() {
  const results = readStore<Result>("imported-results");
  const changes = readStore<ChangelogEntry>("imported-changes");
  const opps = readStore<Opportunity>("imported-opportunities");

  console.log(`Results: ${results.length}, Changes: ${changes.length}, Opps: ${opps.length}`);

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
  const strongest: { score: number; topic: string; change: string; matches: Record<string, string>; factorScores: Record<string, number> }[] = [];
  const weakest: { score: number; topic: string; change: string; matches: Record<string, string>; factorScores: Record<string, number> }[] = [];

  for (const event of events) {
    const result = results.find(r => r.id === event.anchor_result_id);
    if (!result) continue;

    const candidates = discoverCandidates(result, changes, opps);
    totalCandidates += candidates.length;

    for (const c of candidates) {
      allScores.push(c.score);
      for (const [factor, strength] of Object.entries(c.attribution.matches)) {
        if (!factorCounts[factor]) factorCounts[factor] = { strong: 0, partial: 0, none: 0, unknown: 0 };
        factorCounts[factor][strength as string]++;
      }
      strongest.push({
        score: c.score,
        topic: result.topic ?? "?",
        change: c.change.change_description?.slice(0, 50) ?? c.change.asset_name?.slice(0, 50) ?? "?",
        matches: c.attribution.matches as unknown as Record<string, string>,
        factorScores: c.attribution.factor_scores,
      });
    }

    const triage = triageCandidates(candidates);
    if (triage.autoResolved) autoResolved++;
    else needsReview++;
  }

  strongest.sort((a, b) => b.score - a.score);
  const top5 = strongest.slice(0, 5);
  const bottom5 = strongest.slice(-5).reverse();

  console.log(`\nTotal candidates across all events: ${totalCandidates}`);
  console.log(`Auto-resolved events: ${autoResolved}`);
  console.log(`Needs-review events: ${needsReview}`);

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

  console.log(`\nFactor hit rates (across ${allScores.length} candidates):`);
  for (const [factor, counts] of Object.entries(factorCounts)) {
    const total = counts.strong + counts.partial + counts.none + counts.unknown;
    console.log(`  ${factor}: strong=${counts.strong} (${pct(counts.strong, total)}%), partial=${counts.partial} (${pct(counts.partial, total)}%), none=${counts.none} (${pct(counts.none, total)}%), unknown=${counts.unknown} (${pct(counts.unknown, total)}%)`);
  }

  console.log(`\n5 STRONGEST candidates:`);
  for (const c of top5) {
    console.log(`  Score ${c.score} | ${c.topic} | ${c.change}`);
    console.log(`    matches: ${JSON.stringify(c.matches)}`);
    console.log(`    points:  ${JSON.stringify(c.factorScores)}`);
  }

  console.log(`\n5 WEAKEST candidates:`);
  for (const c of bottom5) {
    console.log(`  Score ${c.score} | ${c.topic} | ${c.change}`);
    console.log(`    matches: ${JSON.stringify(c.matches)}`);
    console.log(`    points:  ${JSON.stringify(c.factorScores)}`);
  }
}

function pct(n: number, total: number): string {
  return total > 0 ? Math.round((n / total) * 100).toString() : "0";
}

main().catch(console.error);
