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
import { routeQuestion } from "@/domains/ask/router";
import { assembleAskDossier, buildAskDossier } from "@/domains/ask/fact-assembly";
import { gatherFacts } from "@/domains/ask/providers/registry";
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

  const routed = routeQuestion(trimmed);
  // W9 slice 1 (2026-07-09) - site_trend is the first intent wired end to end through
  // the fact-provider registry (src/domains/ask/providers/registry.ts) instead of
  // fact-assembly.ts's direct switch dispatch. Same underlying loader (GSC daily
  // totals), but the registry's provider stamps freshness + provenance onto every
  // fact, so the rendered answer can say exactly which data it read and how current it
  // is. Every other class still goes through the pre-registry path unchanged.
  const dossier =
    routed.questionClass === "site_trend"
      ? buildAskDossier(routed, await gatherFacts(tenantId, routed).catch(() => []))
      : await assembleAskDossier(routed);
  const answer = await composeAskAnswer(trimmed, dossier);

  const entry: AskHistoryEntry = {
    id: `ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenant_id: tenantId,
    question: trimmed,
    answer,
    questionClass: routed.questionClass,
    askedAt: new Date().toISOString(),
  };
  await appendAskHistory(entry).catch(() => false);

  return { ok: true, question: trimmed, answer };
}

/** Recent Q+A history for the chat's scroll-back, newest first, capped inside the store. */
export async function loadAskHistoryAction(): Promise<AskHistoryEntry[]> {
  return loadAskHistory().catch(() => []);
}
