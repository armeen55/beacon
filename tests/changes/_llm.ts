/**
 * Shared LLM-drafter test fixtures (Core 100K consolidation).
 *
 * `validAnswer` and `fakeComplete` were byte-identical across the drafter
 * suites (llm-schemas, llm-structured-drafter, llm-draft-page). Extracted here
 * so the one grounded answer-block fixture and the queue-replaying completion
 * fn live in a single place. NOT a test file — no describe/it blocks.
 */
import type { CompleteFn } from "@/domains/llm/structured-drafter";

/** The canonical grounded answer-block draft the drafter suites build on. */
export const validAnswer = {
  answer:
    "Persian weddings center on the sofreh aghd, a ceremonial spread of symbolic items the couple sits before while honored guests hold a canopy above them, followed by the aghd vows and a celebratory jashn reception with family and friends. The spread gathers a mirror, twin candelabras, flatbread, fresh herbs, and sweets, each chosen to wish the couple light, health, and a sweet life together. Elders witness the reading of the marriage contract, the newlyweds share a taste of honey, and the music, dancing, and feasting of the reception then carry the celebration late into the night for every guest.",
  citationHook: "the sofreh aghd is the heart of a Persian wedding",
  evidenceRefs: [{ source: "competitor_teardown", detail: "the cited page leads with a sofreh aghd explainer" }],
  confidence: "high",
  risks: ["keep claims neutral"],
  operatorSteps: ["Add this answer block directly under the H1"],
  proofPlan: { metrics: ["Profound citations", "position"], windowsDays: [7, 14, 28], controls: "comparable unchanged pages" },
};

/** A completion fn that replays a fixed queue of responses (last one repeats). */
export function fakeComplete(responses: Array<{ text: string } | { error: string }>): CompleteFn {
  let i = 0;
  return async () => responses[Math.min(i++, responses.length - 1)]!;
}
