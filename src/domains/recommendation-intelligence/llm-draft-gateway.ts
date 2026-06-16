import "server-only";

/**
 * Slice 4.5.E.α₀ (2026-05-21) — LLM-assisted drafting gateway.
 *
 * Pure module that calls the existing OpenAI specific-edit provider
 * through the existing budget + validator gates and returns a
 * discriminated-union draft result. This is the infrastructure-only
 * slice — there is NO caller in production yet. The gateway is
 * callable from tests and from future α₁+ slices that wire trigger
 * predicates → gateway → operator preview surfaces.
 *
 * What this module does NOT do (pinned by architecture invariants):
 *   • Does NOT import `recommended-edits-persistence` /
 *     `persistRecommendedEditsLocal` / `syncRecommendedEdits`.
 *   • Does NOT call `runProviderAndPersist` (the LLM-orchestrator
 *     persistence path stays globally forbidden in the
 *     recommendation-intelligence tree).
 *   • Does NOT write to `recommended_edits` (no Supabase shape).
 *   • Does NOT mutate the input packet.
 *   • Does NOT activate any action type. Type-agnostic — works for
 *     any packet that names a valid LLM-assisted action type.
 *
 * Internal flow (sequential, fail-closed):
 *   1. Pre-call budget gate via `checkBudget()`. If blocked →
 *      `blocked_budget` result; NO LLM call; NO spend recorded.
 *   2. Call `openaiProvider.generate(packet)`. Throw caught →
 *      `validation_failed` with `["llm_call_threw"]`; cost_usd: 0;
 *      NO spend recorded (the provider never charged).
 *   3. On successful response: record bundle's `totalCostUsd` via
 *      `recordSpend()`. ALWAYS — even when the bundle is empty or
 *      validation fails. The LLM call happened; the spend is real.
 *   4. Empty bundle (`recommendations.length === 0`) → `abstained`
 *      with `empty_bundle`.
 *   5. Validate first recommendation via `validateSpecificEdit()`.
 *      Failure → `validation_failed` with validator's field+reason.
 *   6. Extract `targetElement?.proposedText`. Null/empty →
 *      `abstained` with `empty_proposed_text`.
 *   7. Return `drafted` with proposed_text + cost_usd + bundle_size.
 *
 * Pinned by:
 *   • tests/architecture/recommendation-intelligence-llm-draft-
 *     gateway-contract.test.ts
 *   • tests/architecture/recommendation-intelligence-no-queue-
 *     write.test.ts (existing scan set already covers this file)
 */

import {
  checkBudget,
  recordSpend,
} from "@/domains/recommendations/adjudicator-budget";
import { openaiProvider } from "@/domains/recommendations/providers/openai";
import type { SpecificEditEvidencePacket } from "@/domains/recommendations/specific-edit-evidence";
import type {
  SpecificEditBundle,
  SpecificEditConfidence,
  SpecificEditDifficulty,
} from "@/domains/recommendations/specific-edit-provider";
import { validateSpecificEdit } from "@/domains/recommendations/specific-edit-validator";

/**
 * The grounded reasoning the LLM produced alongside the proposed text.
 * The provider ALWAYS fills these (the prompt requires `why`); the
 * gateway used to discard them and return only `proposed_text`. They
 * are the "REAL SPECIFIC REASONING for why" the customer rec needs —
 * surfaced here so a production caller can persist them onto the rec.
 */
export type LlmDraftReasoning = {
  /** Plain-English justification for THIS edit, grounded in packet. */
  why: string;
  confidence: SpecificEditConfidence;
  difficulty: SpecificEditDifficulty;
  /** Operator-facing impact estimate; null when the generator had no
   *  honest signal. */
  expectedImpact: string | null;
  /** How to measure whether the edit moved the needle; null if none. */
  measurementPlan: string | null;
  risks: string[];
  /** How many typed evidence refs justify this edit (depth of grounding). */
  evidenceCount: number;
  /** Specific model id (e.g. `gpt-4o-mini-2024-07-18`); null if absent. */
  model: string | null;
};

export type LlmDraftResult =
  | {
      status: "drafted";
      proposed_text: string;
      cost_usd: number;
      bundle_size: number;
      /** The LLM's grounded reasoning for the drafted edit. */
      reasoning: LlmDraftReasoning;
    }
  | {
      status: "abstained";
      abstention_reason: string;
      cost_usd: number;
    }
  | {
      status: "validation_failed";
      validation_errors: string[];
      cost_usd: number;
    }
  | {
      status: "blocked_budget";
      reason: string;
    };

export type LlmDraftGatewayInput = {
  packet: SpecificEditEvidencePacket;
  /** Defaults to `new Date()`; injectable for tests. */
  now?: Date;
};

export async function draftProposedTextForCandidate(
  input: LlmDraftGatewayInput,
): Promise<LlmDraftResult> {
  const now = input.now ?? new Date();

  // Step 1 — pre-call budget gate.
  const budget = await checkBudget({ now });
  if (!budget.allowed) {
    return { status: "blocked_budget", reason: budget.reason };
  }

  // Step 2 — call the OpenAI provider. Catch throws and surface
  // as a validation_failed result with a stable `llm_call_threw`
  // marker. NO spend recorded (the provider never charged).
  let bundle: SpecificEditBundle;
  try {
    bundle = await openaiProvider.generate(input.packet);
  } catch {
    return {
      status: "validation_failed",
      validation_errors: ["llm_call_threw"],
      cost_usd: 0,
    };
  }

  // Step 3 — always record the bundle's spend on a successful
  // provider response, regardless of downstream outcome. The LLM
  // call happened; the cost is real.
  const cost_usd = bundle.totalCostUsd;
  await recordSpend(cost_usd, { now });

  // Step 4 — empty bundle → abstained.
  if (bundle.recommendations.length === 0) {
    return {
      status: "abstained",
      abstention_reason: "empty_bundle",
      cost_usd,
    };
  }

  // Step 5 — validate the first recommendation.
  const firstEdit = bundle.recommendations[0]!;
  const validation = validateSpecificEdit(firstEdit, input.packet);
  if (!validation.ok) {
    return {
      status: "validation_failed",
      validation_errors: [`${validation.field}: ${validation.reason}`],
      cost_usd,
    };
  }

  // Step 6 — extract proposed_text. Null/empty → abstained.
  const proposed_text = firstEdit.targetElement?.proposedText ?? null;
  if (proposed_text == null || proposed_text.length === 0) {
    return {
      status: "abstained",
      abstention_reason: "empty_proposed_text",
      cost_usd,
    };
  }

  // Step 7 — drafted. Surface the LLM's grounded reasoning alongside
  // the proposed text — the provider always fills `why` + confidence +
  // risks; discarding them (the original behavior) threw away the most
  // valuable part of an LLM-assisted draft.
  return {
    status: "drafted",
    proposed_text,
    cost_usd,
    bundle_size: bundle.recommendations.length,
    reasoning: {
      why: firstEdit.why,
      confidence: firstEdit.confidence,
      difficulty: firstEdit.difficulty,
      expectedImpact: firstEdit.expectedImpact,
      measurementPlan: firstEdit.measurementPlan,
      risks: firstEdit.risks,
      evidenceCount: firstEdit.evidence.length,
      model: firstEdit.model,
    },
  };
}
