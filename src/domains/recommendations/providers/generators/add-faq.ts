/**
 * Sprint 6A.1 Phase 9 (2026-04-24) — `add_faq` deterministic generator.
 *
 * Fires when a question-shaped affected prompt isn't covered by any
 * existing FAQ on a candidate page. For each (question-shaped prompt
 * × candidate page) miss, proposes adding a new FAQ.
 *
 * Question-shape detection lives in `_text-utils.ts:isQuestionLike`.
 * Coverage check is token-overlap against existing
 * `faq_question` elements on the candidate URL — if none of the
 * existing FAQ questions share ≥40% of the prompt's tokens, the
 * prompt counts as "uncovered".
 *
 * `proposedText` is a combined `Q: …\n\nA: …` block:
 *   - Q is the prompt itself, sentence-cased + question-mark-suffixed.
 *   - A is a deterministic seed answer derived from descriptors near
 *     the brand — the operator is expected to rewrite. The Sprint
 *     6A.2 LLM provider will replace the answer body while keeping
 *     the same trigger gate.
 *
 * Pure. No I/O. No DB writes. No LLM. No mutation of input packet.
 */

import { newElementKey } from "@/domains/pages/extractors/element-key";
import { tokenizeForMatch } from "../../page-inventory";
import type { SpecificEditEvidencePacket } from "../../specific-edit-evidence";
import type { SpecificEdit } from "../../specific-edit-provider";
import { asQuestion, isQuestionLike, truncate } from "./_text-utils";

const ACTION_TYPE = "add_faq" as const;
const COVERAGE_THRESHOLD = 0.4;

export function generateAddFaq(
  packet: SpecificEditEvidencePacket,
): SpecificEdit[] {
  if (!packet.allowedActionTypes.includes(ACTION_TYPE)) return [];

  const out: SpecificEdit[] = [];
  const seen = new Set<string>(); // dedupe by (url, elementKey)

  for (const prompt of packet.affectedPrompts) {
    if (!isQuestionLike(prompt.promptText)) continue;
    const promptTokens = new Set(tokenizeForMatch(prompt.promptText));
    if (promptTokens.size === 0) continue;

    for (const candidate of packet.ownedPageCandidates) {
      if (!packet.allowedTargetUrls.includes(candidate.url)) continue;

      const existingFaqs = packet.targetPageElements.filter(
        (el) =>
          el.url === candidate.url && el.elementType === "faq_question",
      );
      const covered = existingFaqs.some((el) => {
        const faqTokens = new Set(tokenizeForMatch(el.elementText ?? ""));
        if (faqTokens.size === 0) return false;
        const overlap = [...promptTokens].filter((t) =>
          faqTokens.has(t),
        ).length;
        const ratio = overlap / promptTokens.size;
        return ratio >= COVERAGE_THRESHOLD;
      });
      if (covered) continue;

      const question = asQuestion(prompt.promptText);
      const elementKey = newElementKey("faq_question", question);
      const dedupeKey = `${candidate.url}\u0000${elementKey}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const answerSeed = composeAnswerSeed(packet, prompt);
      const proposedText = `Q: ${question}\n\nA: ${answerSeed}`;

      out.push({
        actionType: ACTION_TYPE,
        targetUrl: candidate.url,
        targetElement: {
          elementKey,
          displayLabel: `New FAQ: "${truncate(question, 60)}"`,
          currentText: null,
          proposedText,
        },
        why:
          `Prompt "${truncate(prompt.promptText, 80)}" is question-shaped ` +
          `but no existing FAQ on this page covers ≥${Math.round(
            COVERAGE_THRESHOLD * 100,
          )}% of its tokens.`,
        evidence: [
          { type: "prompt", promptId: prompt.promptId },
          { type: "owned_page", url: candidate.url },
        ],
        expectedImpact:
          "Give AI a structured Q&A block that exactly mirrors the " +
          "prompt's question-shape so retrieval grabs this passage as " +
          "the answer source.",
        difficulty: "low",
        confidence: "medium",
        measurementPlan:
          "Re-poll the matching prompt at T+7 / T+14; track whether the " +
          "answer cites this page and whether the brand moves from cited " +
          "to primary.",
        risks: [
          "Auto-generated answer body is a seed — operator must rewrite " +
            "with brand-specific facts and sources before publishing.",
          "Adding FAQs without FAQPage JSON-LD reduces the citation " +
            "lift; operator should keep schema in sync.",
        ],
        source: "deterministic",
        providerName: "deterministic",
        model: null,
        costUsd: null,
      });
    }
  }

  return out;
}

/**
 * Compose a deterministic answer seed from packet content. The
 * operator is expected to rewrite — this is just enough scaffolding
 * to clarify what the answer should reference.
 */
function composeAnswerSeed(
  packet: SpecificEditEvidencePacket,
  prompt: SpecificEditEvidencePacket["affectedPrompts"][number],
): string {
  const descriptors = prompt.descriptorsNearBrand.slice(0, 3);
  if (descriptors.length > 0) {
    return (
      `Draft answer (operator: rewrite). Anchor on: ` +
      `${descriptors.join(", ")}.`
    );
  }
  if (packet.clusterLabel) {
    return (
      `Draft answer (operator: rewrite). Anchor on: ${packet.clusterLabel}.`
    );
  }
  return "Draft answer (operator: rewrite).";
}
