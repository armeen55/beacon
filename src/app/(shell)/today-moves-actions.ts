"use server";

import { isOperatorModeServer } from "@/lib/operator-mode";
import {
  draftAnswerBlockWithLLM,
  type AnswerBlockDraftInput,
  type AnswerBlockDraftResult,
} from "@/domains/demand-graph/llm-answer-block";

/**
 * draftMoveAnswerBlockAction (2026-06-24) — on-demand LLM answer-block draft for a
 * Today's Moves card. Operator-gated; the underlying drafter is OFF unless
 * BEACON_LLM_PROVIDER=openai, budget-gated, and safety-firewalled (see
 * llm-answer-block.ts). Fires only on an explicit click — never on render — so it
 * costs nothing until the operator asks for it.
 */
export async function draftMoveAnswerBlockAction(
  input: AnswerBlockDraftInput,
): Promise<AnswerBlockDraftResult> {
  if (!(await isOperatorModeServer())) return { status: "off" };
  return draftAnswerBlockWithLLM(input);
}
