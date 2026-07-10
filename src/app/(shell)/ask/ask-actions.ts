"use server";

/**
 * ask-actions (BEACON_500 item 59) - the /ask chat's server action. Route/classify/
 * assemble/compose/persist in one call so the client only ever sends the raw question
 * text (tenant ALWAYS comes from trusted server context, never client input, matching
 * every other action in this app). Fail-soft at every stage: a source failure still
 * returns an honest answer (the composer's own fallback), never a thrown error to the
 * client.
 */

import { currentTenantId } from "@/lib/tenant-context";
import { planAsk } from "@/domains/ask/planner";
import { buildAskDossier } from "@/domains/ask/fact-assembly";
import { gatherPlan } from "@/domains/ask/providers/registry";
import { composeAskAnswer } from "@/domains/ask/composer";
import { appendAskHistory, loadAskHistory } from "@/domains/ask/history-store";
import type { AskAnswer, AskHistoryEntry } from "@/domains/ask/types";

export type AskResult = {
  ok: true;
  question: string;
  answer: AskAnswer;
};

/** Ask one question. Always returns ok:true with a real (possibly fallback) answer -
 *  there is no "ok:false" path here because the composer itself never throws and always
 *  produces something honest to show, even with zero facts. */
export async function askQuestionAction(question: string): Promise<AskResult> {
  const trimmed = (question ?? "").trim().slice(0, 500);
  const tenantId = await currentTenantId().catch(() => "");

  // Codex P2 (2026-07-09): FAIL CLOSED on an unresolved tenant. Every fact source
  // is tenant-scoped; without a resolved tenant we cannot know which site is being
  // asked about, so we answer honestly rather than proceed and risk reading (and
  // citing) another tenant's data. Never the founder fallback.
  if (tenantId === "") {
    return {
      ok: true,
      question: trimmed,
      answer: {
        speaker: "llm",
        answer:
          "I cannot tell which site I am looking at right now, so I will not guess at an answer. Please reload the page or reconnect, then ask me again.",
        citedFacts: [],
        source: "fallback",
      },
    };
  }

  // W9 slice 2 (2026-07-10) - EVERY class now goes through the multi-provider planner:
  // planAsk picks the routed primary provider plus any secondary providers whose broad cue
  // words appear (up to 3), with ZERO LLM; gatherPlan runs exactly those, stamps provenance,
  // and merges/caps their facts; the dossier carries the plan's determinism verdict, its
  // selected classes, and its selected provider ids so the composer can bypass the LLM for a
  // deterministic plan and credit specialists honestly for a synthesis. The Slice-1
  // per-class switch (assembleAskDossier) is retired.
  const plan = planAsk(trimmed);
  const facts = await gatherPlan(tenantId, plan).catch(() => []);
  const dossier = buildAskDossier(plan.routed, facts, {
    deterministic: plan.deterministic,
    selectedClasses: plan.selectedClasses,
    plannedProviderIds: plan.selections.map((s) => s.provider.id),
    maxFacts: 12,
  });
  const answer = await composeAskAnswer(trimmed, dossier);

  const entry: AskHistoryEntry = {
    id: `ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenant_id: tenantId,
    question: trimmed,
    answer,
    questionClass: plan.routed.questionClass,
    askedAt: new Date().toISOString(),
  };
  await appendAskHistory(entry).catch(() => false);

  return { ok: true, question: trimmed, answer };
}

/** Recent Q+A history for the chat's scroll-back, newest first, capped inside the store. */
export async function loadAskHistoryAction(): Promise<AskHistoryEntry[]> {
  return loadAskHistory().catch(() => []);
}
