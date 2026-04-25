/**
 * Sprint 6A.1 Phase 9 (2026-04-24) — `edit_title` deterministic generator.
 *
 * Fires when an owned candidate page's `<title>` lacks any of the
 * cluster's keyword tokens. Proposes a rewritten title that surfaces
 * the cluster intent at the front while preserving the existing
 * brand suffix.
 *
 * Pure function. No I/O. No DB writes. No LLM. No mutation of the
 * input packet.
 *
 * Skip conditions (return zero rows for that candidate):
 *   - `edit_title` not in `packet.allowedActionTypes`
 *   - `packet.clusterLabel` is null (no cluster keywords to test for)
 *   - candidate URL has no `title` element in `targetPageElements`
 *     (can't edit what isn't extracted)
 *   - current title already contains EVERY cluster token (already
 *     covered)
 *
 * Confidence is `medium` and difficulty is `low`: deterministic
 * keyword-coverage is a real signal but the generator can't judge
 * whether the proposed wording reads natural for the operator's brand
 * voice. The Sprint 6A.2 LLM provider will replace the wording while
 * keeping the same trigger gate.
 */

import { tokenizeForMatch } from "../../page-inventory";
import type { SpecificEditEvidencePacket } from "../../specific-edit-evidence";
import type { SpecificEdit } from "../../specific-edit-provider";
import { titleCase } from "./_text-utils";

const ACTION_TYPE = "edit_title" as const;

export function generateEditTitle(
  packet: SpecificEditEvidencePacket,
): SpecificEdit[] {
  if (!packet.allowedActionTypes.includes(ACTION_TYPE)) return [];
  if (!packet.clusterLabel) return [];

  const clusterTokens = tokenizeForMatch(packet.clusterLabel);
  if (clusterTokens.length === 0) return [];
  const clusterTokenSet = new Set(clusterTokens);

  const out: SpecificEdit[] = [];
  for (const candidate of packet.ownedPageCandidates) {
    if (!packet.allowedTargetUrls.includes(candidate.url)) continue;

    const titleElement = packet.targetPageElements.find(
      (el) => el.url === candidate.url && el.elementType === "title",
    );
    if (!titleElement) continue;

    const currentText = titleElement.elementText ?? "";
    const titleTokens = new Set(tokenizeForMatch(currentText));
    const missingTokens = [...clusterTokenSet].filter(
      (t) => !titleTokens.has(t),
    );
    if (missingTokens.length === 0) continue;

    const proposed = composeProposedTitle(packet.clusterLabel, currentText);

    const promptIds = packet.affectedPrompts.map((p) => p.promptId);

    out.push({
      actionType: ACTION_TYPE,
      targetUrl: candidate.url,
      targetElement: {
        elementKey: titleElement.elementKey,
        displayLabel: titleElement.displayLabel,
        currentText: titleElement.elementText,
        proposedText: proposed,
      },
      why:
        `Page title is missing ${missingTokens.length} cluster ` +
        `keyword(s) (${missingTokens.join(", ")}) that AI uses to ` +
        `describe this topic.`,
      evidence: [
        ...promptIds.map((id) => ({ type: "prompt" as const, promptId: id })),
        {
          type: "element" as const,
          elementKey: titleElement.elementKey,
          url: candidate.url,
        },
        { type: "owned_page" as const, url: candidate.url },
      ],
      expectedImpact:
        "Surface cluster intent in the title so AI ranks this page " +
        "as the canonical answer for affected prompts.",
      difficulty: "low",
      confidence: "medium",
      measurementPlan:
        "Re-poll affected prompts at T+7 / T+14 / T+28 days; compare " +
        "owned-page citation count vs. baseline.",
      risks: [
        "Title length may exceed search-result truncation (~60 chars).",
        "Surfacing the cluster intent up-front shifts brand emphasis to " +
          "the end of the tag.",
      ],
      source: "deterministic",
      providerName: "deterministic",
      model: null,
      costUsd: null,
    });
  }

  return out;
}

/**
 * Compose a deterministic proposed title:
 *   - If current title has a "·" / "|" / "—" separator, prepend the
 *     title-cased cluster label IN FRONT of the first segment.
 *   - Otherwise prepend "{Title Case Cluster}: {currentTitle}".
 *
 * Pure. No LLM creativity — that's Sprint 6A.2's job.
 */
function composeProposedTitle(
  clusterLabel: string,
  currentTitle: string,
): string {
  const cluster = titleCase(clusterLabel.trim());
  if (!currentTitle.trim()) return cluster;

  const sepMatch = currentTitle.match(/\s+([·|—–-])\s+/);
  if (sepMatch) {
    // Replace the leading segment with "{cluster} {separator} {brandTail}"
    const sep = sepMatch[1];
    const idx = currentTitle.indexOf(sepMatch[0]);
    const tail = currentTitle.slice(idx + sepMatch[0].length).trim();
    return `${cluster} ${sep} ${tail}`;
  }

  // No separator → just prefix with the cluster + colon.
  return `${cluster}: ${currentTitle.trim()}`;
}
