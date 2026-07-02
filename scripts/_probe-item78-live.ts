/**
 * Ground-truth probe for BEACON 500 item 78 (2026-07-02), LIVE variant.
 *
 * The synced tenant-iranopedia `page_snapshots` in Supabase predate the
 * body_paragraph_sample field (Plan A/B1, 2026-04-20) — all 217 rows have
 * h2_list/word_count but zero paragraph text, and profound_fanout_rows is
 * empty for this tenant too (0 fanout seeds). Both are honest findings, not
 * bugs in this module. To still ground-truth real coverage numbers, this
 * probe live-fetches 5 real Iranopedia pages (read-only, single fetch each,
 * same technique as scripts/ground-truth-expert-rec.ts), extracts a REAL
 * PageSnapshot (so body_paragraph_sample is populated), and scores it against
 * the page's own H2 headings turned into questions (a fair stand-in for
 * fanout questions when none are synced — H2s ARE the sub-topics AI would
 * ask about this page).
 *
 * Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/_probe-item78-live.ts
 */

import { getRepository } from "../src/lib/persistence/repositories";
import { extractPageSnapshot } from "../src/domains/pages/extractor";
import { computePageAnswerabilityCoverage } from "../src/domains/pages/passage-answerability";

function h2ToQuestion(h2: string): string {
  const t = h2.trim();
  if (/\?$/.test(t)) return t;
  return `What about: ${t}?`;
}

async function main() {
  const tenantId = "tenant-iranopedia";
  const repo = getRepository().forTenant(tenantId);
  const snaps = await repo.getPageSnapshots();
  console.log(`Synced page_snapshots: ${snaps.length}`);
  console.log(`Synced snapshots with body_paragraph_sample: ${snaps.filter((s) => (s.body_paragraph_sample?.length ?? 0) > 0).length} (honest: 0 — pre-dates that field)\n`);

  // Pick 5 diverse, real, distinct URLs (varied word_count so we sample both
  // thin and substantial pages), skip anything without an http(s) URL.
  const candidates = snaps
    .filter((s) => /^https?:\/\//.test(s.url) && (s.h2_list?.length ?? 0) >= 2)
    .sort((a, b) => b.word_count - a.word_count);
  const picks = [
    ...candidates.slice(0, 3), // 3 substantial pages
    ...candidates.slice(-2), // 2 thin pages
  ];

  type Row = { url: string; title: string | null; coveragePercent: number; bestPassage: string | null; bestScore: number; uncovered: string[] };
  const rows: Row[] = [];

  for (const s of picks) {
    try {
      const res = await fetch(s.url, { headers: { "User-Agent": "BeaconGroundTruth/1.0" }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        console.log(`SKIP ${s.url}: HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      const live = extractPageSnapshot(html, s.url, s.page_id, tenantId, res.status);
      const passages = live.body_paragraph_sample ?? [];
      const questions = (live.h2_list ?? []).slice(0, 6).map(h2ToQuestion);
      const coverage = computePageAnswerabilityCoverage(s.url, passages, questions);
      rows.push({
        url: s.url,
        title: live.title,
        coveragePercent: coverage.coveragePercent,
        bestPassage: coverage.bestPassage,
        bestScore: coverage.bestPassageScore,
        uncovered: coverage.uncoveredQuestions.map((q) => `${q.question} :: ${q.failures[0] ?? ""}`),
      });
      console.log(`FETCHED ${s.url} — ${passages.length} passages, ${questions.length} questions -> ${coverage.coveragePercent}% coverage`);
    } catch (e) {
      console.log(`SKIP ${s.url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`\n=== Real coverage table (${rows.length} live-fetched pages) ===`);
  rows.sort((a, b) => b.coveragePercent - a.coveragePercent);
  for (const r of rows) {
    console.log(`${r.coveragePercent}%  ${r.title ?? r.url}`);
    console.log(`  ${r.url}`);
    if (r.uncovered.length) console.log(`  uncovered: ${r.uncovered.slice(0, 2).join(" | ")}`);
  }

  const best = rows.find((r) => r.bestPassage);
  if (best) {
    console.log(`\n=== Example real best passage (score ${best.bestScore}) ===`);
    console.log(`Page: ${best.title}`);
    console.log(`"${best.bestPassage}"`);
  }

  if (rows.length > 0) {
    const avg = Math.round(rows.reduce((s, r) => s + r.coveragePercent, 0) / rows.length);
    console.log(`\nAverage across ${rows.length} live-fetched pages: ${avg}%`);
  }
}

main().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
