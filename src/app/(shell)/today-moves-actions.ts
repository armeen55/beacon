"use server";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import {
  draftAnswerBlockWithLLM,
  draftFaqSchemaWithLLM,
  type AnswerBlockDraftInput,
  type AnswerBlockDraftResult,
  type FaqDraftInput,
  type FaqDraftResult,
} from "@/domains/demand-graph/llm-answer-block";
import { saveMoveDraft } from "@/domains/demand-graph/move-draft-store";

/**
 * draftMoveAnswerBlockAction (2026-06-24) — on-demand LLM answer-block draft for a
 * Today's Moves card. Operator-gated; the underlying drafter is OFF unless
 * BEACON_LLM_PROVIDER=openai, budget-gated, and safety-firewalled (see
 * llm-answer-block.ts). Fires only on an explicit click — never on render — so it
 * costs nothing until the operator asks for it.
 */
export async function draftMoveAnswerBlockAction(
  input: AnswerBlockDraftInput & { recId?: string },
): Promise<AnswerBlockDraftResult> {
  if (!(await isOperatorModeServer())) return { status: "off" };
  const result = await draftAnswerBlockWithLLM(input);
  if (result.status === "ok" && input.recId) {
    try {
      await saveMoveDraft(await currentTenantId(), input.recId, "answer_block", result.text);
    } catch {
      /* persistence is best-effort — never fail the draft on a store hiccup */
    }
  }
  return result;
}

/** On-demand FAQPage JSON-LD draft (LLM answers the grounded fanout questions →
 *  valid schema). Same gating/budget/firewall as the answer-block drafter.
 *  Persists the result (best-effort) so it survives reload. */
export async function draftMoveFaqAction(
  input: FaqDraftInput & { recId?: string },
): Promise<FaqDraftResult> {
  if (!(await isOperatorModeServer())) return { status: "off" };
  const result = await draftFaqSchemaWithLLM(input);
  if (result.status === "ok" && input.recId) {
    try {
      await saveMoveDraft(await currentTenantId(), input.recId, "faq", result.jsonLd);
    } catch {
      /* best-effort */
    }
  }
  return result;
}
