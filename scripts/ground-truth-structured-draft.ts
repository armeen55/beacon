/**
 * Ground-truth the structured drafter (P4) on ONE real Iranopedia Move (2026-06-25).
 *
 * Read-only proof that draftAnswerBlockStructured runs end-to-end: gate → budget →
 * call → Zod validate → firewalls. ONE capped paid LLM call (gpt-5-mini, ~$0.01-0.02,
 * inside the monthly cap). NO writes, NO publish. Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-structured-draft.ts
 */

import { loadChangePacksForTenant } from "@/domains/demand-graph/gap-compiler";
import { draftAnswerBlockStructured } from "@/domains/llm/structured-drafter";

const TENANT = process.env.BEACON_GROUND_TRUTH_TENANT ?? "tenant-iranopedia";

async function main() {
  console.log(`\n=== Structured drafter ground-truth · tenant=${TENANT} ===\n`);
  const { packets } = await loadChangePacksForTenant(TENANT, { limit: 10 });
  // Pick the top answer_block / edit_page Move (an existing-page Move with a brief).
  const target =
    packets.find((p) => p.move.gapType === "answer_block") ??
    packets.find((p) => p.move.gapType === "edit_page") ??
    packets[0];
  if (!target) {
    console.log("No packets (engine off or env not loaded: set -a; . ./.env.local; set +a).");
    return;
  }

  console.log(`Move: "${target.move.label}"  (gap=${target.move.gapType}, score=${target.move.score})`);
  console.log(`Page: ${target.yourPage.url ?? "(new page)"}`);
  console.log(`Grounding: brief=${!!target.draft.answerBlockBrief} outline=${target.draft.outline.length} fanouts=${target.demand.fanoutSeeds.length}\n`);

  // Qualitative hints only — do NOT feed raw stat counts, so the model isn't
  // tempted to quote numbers into the answer (the numeric-fidelity firewall would
  // reject any not present in the grounding).
  const evidenceHints = [
    target.competitor.domain && !target.competitor.looselyMatched ? `AI cites ${target.competitor.domain} for this topic, not you` : "",
    target.yourPage.gsc ? "the page already ranks on Google but isn't the cited source" : "",
  ].filter(Boolean);

  const result = await draftAnswerBlockStructured({
    query: target.move.label,
    pageLabel: target.yourPage.url ?? target.move.label,
    brief: target.draft.answerBlockBrief,
    outline: target.draft.outline,
    faqs: target.draft.faqQuestions.length ? target.draft.faqQuestions : target.demand.fanoutSeeds,
    evidenceHints,
  });

  console.log(`STATUS: ${result.status}`);
  if (result.status === "drafted") {
    console.log(`cost: $${result.costUsd.toFixed(4)}  retried: ${result.retried}\n`);
    console.log("answer:", result.value.answer);
    console.log("citationHook:", result.value.citationHook);
    console.log("confidence:", result.value.confidence);
    console.log("evidenceRefs:", JSON.stringify(result.value.evidenceRefs));
    console.log("risks:", JSON.stringify(result.value.risks));
    console.log("operatorSteps:", JSON.stringify(result.value.operatorSteps));
    console.log("proofPlan:", JSON.stringify(result.value.proofPlan));
    console.log(`\nword count: ${result.value.answer.split(/\s+/).length}`);
  } else if (result.status === "validation_failed") {
    console.log(`cost: $${result.costUsd.toFixed(4)}  retried: ${result.retried}`);
    console.log("errors:", JSON.stringify(result.errors, null, 2));
  } else {
    console.log(JSON.stringify(result));
  }
}

main().catch((e) => {
  console.error("ground-truth failed:", e);
  process.exit(1);
});
