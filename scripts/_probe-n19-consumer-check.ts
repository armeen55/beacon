/**
 * N19 downstream-consumer check (2026-07-02, read-only). Proves
 * passage-answerability.ts (owned by item 78, NOT edited here) picks up the
 * fixed extractor's output with zero changes on its side. This is the exact
 * "verify at least one consumer picks it up read-only" requirement.
 *
 * Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/_probe-n19-consumer-check.ts
 */
import { extractPageSnapshot } from "../src/domains/pages/extractor";
import { computePageAnswerabilityCoverage } from "../src/domains/pages/passage-answerability";

async function main() {
  const url = "https://www.iranopedia.com/iran-animals";
  const res = await fetch(url, { headers: { "User-Agent": "BeaconGroundTruth/1.0" } });
  const html = await res.text();
  const snap = extractPageSnapshot(html, url, "probe-consumer", "tenant-iranopedia", res.status);

  console.log("body_paragraph_sample from the FIXED extractor:", snap.body_paragraph_sample);
  console.log();

  // A fair fanout-question stand-in built from this page's own real H2s (same
  // technique the item-78 live probe used when no fanout seeds are synced).
  const questions = (snap.h2_list ?? []).length > 0
    ? snap.h2_list!.map((h) => `What about: ${h}?`)
    : ["What animals live in Iran?"];

  const coverage = computePageAnswerabilityCoverage(url, snap.body_paragraph_sample ?? [], questions);
  console.log(`passage-answerability.ts coverage for ${url}:`);
  console.log(`  coveragePercent: ${coverage.coveragePercent}%  (was 0% before N19 - zero paragraphs existed)`);
  console.log(`  bestPassage: "${coverage.bestPassage}"`);
  console.log(`  bestPassageScore: ${coverage.bestPassageScore}`);
}

main();
