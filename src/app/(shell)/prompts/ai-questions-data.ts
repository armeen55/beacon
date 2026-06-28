import "server-only";
import { cache } from "react";

import { currentTenantId } from "@/lib/tenant-context";
import { loadActionPackWorklistForTenant } from "@/domains/action-pack/load";
import { ACTION_LABEL, type ActionPack } from "@/domains/action-pack/types";

/**
 * AI Questions data (2026-06-28 — route consolidation) — the real "AI questions"
 * surface, derived from the CANONICAL ActionPack brain's Profound receipts (the
 * same cached prompt/fanout/citation evidence the worklist + cockpit already use).
 *
 * The legacy /prompts page read `tracked_prompts` (the borrowed-account tracked
 * prompt library), which is EMPTY for Iranopedia — so the page lied ("no questions
 * added") while Profound had hundreds of prompts behind the moves. This reads from
 * the brain instead: every pack with a Profound receipt IS an AI question, with who
 * AI cites, whether we're absent, and a link to the move that answers it.
 * Read-only, cached/durable only — NO live Profound API.
 */
export type AiQuestion = {
  id: string;
  prompt: string;
  promptCount: number;
  fanoutCount: number;
  citedDomains: string[];
  ownAbsent: boolean;
  moveLabel: string;
  actionLabel: string;
  targetUrl: string | null;
};

export type AiQuestionsData = {
  questions: AiQuestion[];
  totals: {
    questions: number;
    fanouts: number;
    citedDomains: number;
    absent: number;
    cited: number;
  };
};

const EMPTY: AiQuestionsData = {
  questions: [],
  totals: { questions: 0, fanouts: 0, citedDomains: 0, absent: 0, cited: 0 },
};

function buildFromPacks(packs: ActionPack[]): AiQuestionsData {
  const seen = new Set<string>();
  const questions: AiQuestion[] = [];
  for (const p of packs) {
    const r = p.profoundReceipt;
    if (!r || !r.topPrompt.trim()) continue;
    const key = r.topPrompt.toLowerCase().trim();
    if (seen.has(key)) continue; // one row per distinct AI question
    seen.add(key);
    questions.push({
      id: p.id,
      prompt: r.topPrompt,
      promptCount: r.promptCount,
      fanoutCount: r.fanoutCount,
      citedDomains: r.citedDomains,
      ownAbsent: r.ownAbsent,
      moveLabel: p.label,
      actionLabel: ACTION_LABEL[p.actionType],
      targetUrl: p.targetUrl,
    });
  }
  // Opportunity-first: questions where AI cites rivals but NOT us, then by breadth
  // (fanouts) and how contested they are (cited-domain count).
  questions.sort(
    (a, b) =>
      Number(b.ownAbsent) - Number(a.ownAbsent) ||
      b.fanoutCount - a.fanoutCount ||
      b.citedDomains.length - a.citedDomains.length,
  );

  const domains = new Set<string>();
  let fanouts = 0;
  for (const q of questions) {
    fanouts += q.fanoutCount;
    for (const d of q.citedDomains) domains.add(d.toLowerCase());
  }
  return {
    questions,
    totals: {
      questions: questions.length,
      fanouts,
      citedDomains: domains.size,
      absent: questions.filter((q) => q.ownAbsent).length,
      cited: questions.filter((q) => !q.ownAbsent).length,
    },
  };
}

async function loadUncached(tenantId: string): Promise<AiQuestionsData> {
  const wl = await loadActionPackWorklistForTenant(tenantId).catch(() => null);
  if (!wl) return EMPTY;
  return buildFromPacks(wl.packs);
}

/** Request-memoized AI questions, ActionPack-powered. */
export const loadAiQuestions = cache(
  async (): Promise<AiQuestionsData> => loadUncached(await currentTenantId()),
);
