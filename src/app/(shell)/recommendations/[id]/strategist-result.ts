/**
 * StrategistActionResult + the deterministic fallback builder.
 *
 * Lives in a PLAIN module (NOT "use server") because `llm-strategist-action.ts`
 * is a server-actions file where every export must be an async action — a
 * synchronous helper/type cannot be exported from there. This pure module holds
 * the shared result type + the deterministic fallback so the action file (and
 * the panel + tests) can import them. Pure / no I/O.
 */

import type { ExpertSynthesis } from "@/domains/recommendations/llm-expert-strategist";
import type { RecommendationActionRow } from "@/domains/recommendations/recommendation-action-rows";

export type StrategistActionResult = {
  /** Trust audit C (2026-06-16): which engine produced this panel. "llm" =
   *  the senior-strategist + adversarial critic; "deterministic" = the visible
   *  fallback shown when the LLM is unavailable (no key / budget / sanitize /
   *  timeout / kill-switch) so the panel is NEVER silently absent. */
  source: "llm" | "deterministic";
  strategist: ExpertSynthesis["strategist"];
  enforcedConfidence: ExpertSynthesis["enforcedConfidence"];
  enforcedApprove: boolean;
  gateNotes: string[];
  /** The adversarial QA critic review (the "Adversarial QA" panel), or null. */
  criticReview: ExpertSynthesis["criticReview"];
  /** Customer-readable evidence families backing this rec (the receipt). */
  evidenceSupports: string[];
  /** Evidence families NOT present (honest gaps) — surfaced in the fallback. */
  evidenceMissing: string[];
};

/**
 * Trust audit C (2026-06-16) — the DETERMINISTIC fallback panel. Built purely
 * from the row's already-computed QA verdict + the grounded "why this matters"
 * narrative, so when the LLM is unavailable the detail page shows Beacon's
 * deterministic read (verdict + evidence receipt + missing evidence) instead of
 * silently dropping back to the bare brief. NO AI-citation claims, no secrets,
 * no raw errors — only the deterministic verdict the gate already produced.
 * Pure + exported for tests.
 */
export function buildDeterministicStrategistResult(
  row: RecommendationActionRow,
  whyNarrative: string,
): StrategistActionResult {
  const qa = row.detail.qaVerdict ?? null;
  const evidenceSupports = qa?.evidenceSupports ?? [];
  const evidenceMissing = qa?.evidenceMissing ?? [];
  const confidence = qa?.confidence ?? "needs_more_evidence";
  const approve = qa?.approve ?? false;
  const whyExists = qa?.whyExists ?? "";
  const expectedOutcome =
    evidenceSupports.length > 0
      ? `Grounded in ${evidenceSupports.join(", ")}.`
      : (qa?.whyMatchValid ?? "");
  return {
    source: "deterministic",
    strategist: {
      opportunitySummary: whyExists || row.title,
      whyThisNow: whyNarrative || qa?.whyMatchValid || whyExists,
      bestAction: row.title,
      alternativesConsidered: [],
      whyNotAlternatives: [],
      expectedOutcome,
      riskLevel: approve ? "low" : "medium",
      risks: [],
    },
    enforcedConfidence: confidence,
    enforcedApprove: approve,
    gateNotes: qa?.confidenceReason ? [qa.confidenceReason] : [],
    criticReview: null,
    evidenceSupports,
    evidenceMissing,
  };
}
