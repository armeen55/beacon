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
 *   - A is a deterministic seed answer composed from descriptors near
 *     the brand. When no descriptors exist (and the cluster label
 *     can't carry the answer alone), the generator ABSTAINS — emits
 *     no edit at all rather than a placeholder. The Sprint 6A.2 LLM
 *     provider (W3 Step 3.4) will replace the answer body while
 *     keeping the same trigger gate.
 *
 * W3 Step 3.1 (2026-05-01) — better empty than bad. The generator
 * now abstains in two cases:
 *   1. composeAnswerSeed returns null — happens when descriptors are
 *      absent AND the cluster label alone can't anchor a 25+ word
 *      answer. The deterministic shape can't fabricate specific
 *      content, so it doesn't try.
 *   2. The composed answer body fails evaluateFaqAnswer — too short,
 *      mostly repeats the question, or has no specific content.
 *      Validator would reject it anyway; abstaining keeps the queue
 *      cleaner and avoids wasted generator output in test fixtures.
 *
 * Pure. No I/O. No DB writes. No LLM. No mutation of input packet.
 */

import { newElementKey } from "@/domains/pages/extractors/element-key";
import { tokenizeForMatch } from "../../page-inventory";
import { evaluateFaqAnswer } from "../../placeholder-detection";
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

      // W3 Step 3.1 (2026-05-01) — abstain when we can't compose a
      // structurally usable answer body. composeAnswerSeed returns
      // null when descriptors + cluster label are both empty OR when
      // the resulting body would fail evaluateFaqAnswer. Either way:
      // better empty than bad. Roll back the dedupe entry so a
      // sibling candidate (different URL, same prompt) can still try.
      const answerSeed = composeAnswerSeed(packet, prompt, question);
      if (answerSeed === null) {
        seen.delete(dedupeKey);
        continue;
      }

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
          "Deterministic seed answer cites real descriptors AI uses near " +
            "your brand; operator should still review for brand voice " +
            "before publishing.",
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
 * Compose a deterministic answer body from real packet evidence, or
 * abstain.
 *
 * W3 Step 3.1 (2026-05-01) — never emits placeholder copy. Returns
 * `null` when:
 *   - descriptors near the brand are absent AND cluster label is
 *     absent / empty, OR
 *   - the composed body would fail evaluateFaqAnswer (too short,
 *     mostly repeats the question, or no specific content beyond
 *     generic filler).
 *
 * Returning null tells the caller to abstain — emit no edit for this
 * (prompt × candidate) pair. Better empty than bad. The W3 Step 3.4
 * LLM provider, with the full evidence packet, will fill these gaps.
 *
 * Pure. Deterministic. The composed text references concrete content
 * from the packet (descriptors AI actually uses, the cluster label)
 * so the operator can decide whether to ship as-is, rewrite, or
 * dismiss.
 */
function composeAnswerSeed(
  packet: SpecificEditEvidencePacket,
  prompt: SpecificEditEvidencePacket["affectedPrompts"][number],
  questionText: string,
): string | null {
  const descriptors = prompt.descriptorsNearBrand.slice(0, 5);
  const cluster = packet.clusterLabel?.trim() ?? "";

  // Branch A — multiple descriptors carry the answer. We surface the
  // actual descriptors AI uses to talk about the brand, anchored on
  // the cluster context when present. This is real evidence, not a
  // placeholder.
  if (descriptors.length >= 2) {
    const descriptorList = descriptors.join(", ");
    const clusterPhrase = cluster ? ` for ${cluster}` : "";
    const answer =
      `AI consistently describes our work${clusterPhrase} as ${descriptorList}. ` +
      `These themes show up across the answer engines that respond to ` +
      `questions like the one above, so the section below leads with ` +
      `concrete examples of how those themes play out on the projects ` +
      `we deliver.`;
    if (evaluateFaqAnswer({ question: questionText, answer }).ok) {
      return answer;
    }
    // If the descriptor-based body still fails the structural gate
    // (most often because every descriptor collides with question
    // tokens), fall through to the cluster branch.
  }

  // Branch B — single descriptor + cluster label can carry a usable
  // answer when both are present. Without both, there isn't enough
  // specific content to clear MIN_SPECIFIC_CONTENT_WORDS.
  if (descriptors.length === 1 && cluster) {
    const answer =
      `AI describes our work in ${cluster} most often as ${descriptors[0]}. ` +
      `The section below explains what that pattern looks like on the ` +
      `ground for homeowners weighing the decision the question raises, ` +
      `with examples drawn from comparable projects in the area.`;
    if (evaluateFaqAnswer({ question: questionText, answer }).ok) {
      return answer;
    }
  }

  // Branch C — abstain. Without enough real evidence, the deterministic
  // shape can't compose a body that clears MIN_FAQ_ANSWER_WORDS with
  // specific content. The W3 Step 3.4 LLM provider is the right tool
  // for this gap.
  return null;
}
