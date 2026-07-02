/**
 * Ground-truth probe for BEACON 500 item 78 (2026-07-02) — passage-level
 * quotable coverage on real tenant-iranopedia data. NOT a product surface,
 * a one-off proof. Run:
 *   set -a; . ./.env.local; set +a
 *   BEACON_TENANT_ID=tenant-iranopedia npx tsx scripts/_probe-item78-quotable-coverage.ts
 */

import { getRepository } from "../src/lib/persistence/repositories";
import { loadFanoutSeedsForTenant, fanoutSeedsForNode } from "../src/domains/demand-graph/load-fanout-seeds";
import { computePageAnswerabilityCoverage } from "../src/domains/pages/passage-answerability";
import { evaluateDraftQuality } from "../src/domains/drafts/draft-quality";
import { getLatestMoveDrafts } from "../src/domains/demand-graph/move-draft-store";
import { parsePreparedPack } from "../src/domains/demand-graph/prepared-move-pack";

async function main() {
  const tenantId = process.env.BEACON_TENANT_ID ?? "tenant-iranopedia";
  console.log(`\n=== BEACON 500 item 78 ground truth: ${tenantId} ===\n`);

  const repo = getRepository().forTenant(tenantId);
  const [snapshots, fanoutSeeds] = await Promise.all([
    repo.getPageSnapshots(),
    loadFanoutSeedsForTenant(tenantId),
  ]);

  console.log(`page_snapshots: ${snapshots.length}`);
  console.log(`fanout seeds:   ${fanoutSeeds.length}`);

  const withBody = snapshots.filter((s) => (s.body_paragraph_sample?.length ?? 0) > 0);
  console.log(`snapshots with body_paragraph_sample: ${withBody.length}\n`);

  type Row = {
    url: string;
    title: string | null;
    questions: number;
    coveragePercent: number;
    bestPassageScore: number;
    bestPassage: string | null;
    uncovered: string[];
  };

  const rows: Row[] = [];
  for (const s of withBody) {
    const questions = fanoutSeedsForNode(s.title ?? s.url, [s.title ?? "", ...(s.h2_list ?? [])], fanoutSeeds, 8);
    if (questions.length === 0) continue;
    const coverage = computePageAnswerabilityCoverage(s.url, s.body_paragraph_sample!, questions);
    rows.push({
      url: s.url,
      title: s.title,
      questions: questions.length,
      coveragePercent: coverage.coveragePercent,
      bestPassageScore: coverage.bestPassageScore,
      bestPassage: coverage.bestPassage,
      uncovered: coverage.uncoveredQuestions.map((q) => `${q.question} :: ${q.failures[0] ?? ""}`),
    });
  }

  console.log(`pages with >=1 matched fanout question: ${rows.length}\n`);

  if (rows.length === 0) {
    console.log("HONEST EMPTY: no page had both body_paragraph_sample AND a matched fanout question.");
    console.log("(See scripts/_probe-item78-live.ts for real coverage numbers via live-fetch.)\n");
  } else {
    rows.sort((a, b) => b.coveragePercent - a.coveragePercent);
    const best5 = rows.slice(0, 5);
    const worst5 = [...rows].sort((a, b) => a.coveragePercent - b.coveragePercent).slice(0, 5);

    console.log("BEST 5 (highest quotable coverage)");
    for (const r of best5) {
      console.log(`${r.coveragePercent}%  (${r.questions} questions)  ${r.title ?? r.url}`);
    }
    console.log("\nWORST 5 (lowest quotable coverage)");
    for (const r of worst5) {
      console.log(`${r.coveragePercent}%  (${r.questions} questions)  ${r.title ?? r.url}`);
      for (const u of r.uncovered.slice(0, 2)) console.log(`    uncovered: ${u}`);
    }

    const avg = Math.round(rows.reduce((s, r) => s + r.coveragePercent, 0) / rows.length);
    console.log(`\nAverage quotable coverage across ${rows.length} pages: ${avg}%`);

    const exampleWithPassage = rows.find((r) => r.bestPassage && r.bestPassageScore >= 75) ?? rows.find((r) => r.bestPassage);
    if (exampleWithPassage) {
      console.log(`\nExample best passage (score ${exampleWithPassage.bestPassageScore})`);
      console.log(`Page: ${exampleWithPassage.title ?? exampleWithPassage.url}`);
      console.log(`"${exampleWithPassage.bestPassage}"`);
    }
  }

  // ── draft-rejection impact: how many CURRENTLY-READY drafts would newly fail
  // the quotability check added to evaluateDraftQuality? ──
  console.log(`\n=== Draft-rejection impact (quotability check on existing move drafts) ===\n`);
  const drafts = await getLatestMoveDrafts(tenantId).catch(() => new Map());
  let totalAnswerBlocks = 0;
  let wasReady = 0;
  let nowNotQuotable = 0;
  const examples: string[] = [];

  for (const [key, draft] of drafts.entries()) {
    if (!key.endsWith("::prepared_pack")) continue;
    const pack = parsePreparedPack(draft.content);
    if (!pack || pack.structuredDraft?.kind !== "answer_block") continue;
    const v = pack.structuredDraft.value as Record<string, unknown>;
    const answer = typeof v.answer === "string" ? v.answer : "";
    if (!answer) continue;
    totalAnswerBlocks += 1;
    const evidenceRefs = Array.isArray(v.evidenceRefs) ? v.evidenceRefs.length : 0;
    const result = evaluateDraftQuality({ answer, evidenceRefs, query: pack.primaryQuery ?? undefined });
    if (result.status === "ready" || result.status === "useful_but_needs_review") wasReady += 1;
    if (result.status === "not_quotable") {
      nowNotQuotable += 1;
      if (examples.length < 3) examples.push(`${key}: ${result.reasons[0]}`);
    }
  }

  console.log(`Total answer_block drafts found: ${totalAnswerBlocks}`);
  console.log(`Currently ready/needs-review: ${wasReady}`);
  console.log(`Newly rejected as not_quotable: ${nowNotQuotable}`);
  for (const e of examples) console.log(`  example: ${e}`);
}

main().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
