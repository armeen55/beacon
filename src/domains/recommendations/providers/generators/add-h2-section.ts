/**
 * Sprint 6A.1 Phase 9 (2026-04-24) — `add_h2_section` deterministic generator.
 *
 * Fires when a competitor angle (top entry in `competitorAngles`) or
 * the cluster label itself isn't covered by any existing H2 on the
 * candidate page. Proposes adding a new H2 that targets the gap.
 *
 * Trigger order (first match wins per candidate URL):
 *   1. Top competitor angle missing from existing H2s → propose
 *      "Why teams choose us over {Competitor}".
 *   2. Cluster label tokens missing from existing H2s → propose
 *      "{Title-cased cluster label}: what to know".
 *
 * Both branches use the SAME element-key pattern
 * (`h2[new]:<contentHash(proposedText)>`). The validation layer
 * (Phase 6A.1.10) will accept `h2[new]:*` for `add_h2_section`.
 *
 * Skip conditions:
 *   - `add_h2_section` not in `packet.allowedActionTypes`
 *   - candidate URL not in `packet.allowedTargetUrls`
 *   - both signals are empty (no top competitor AND no cluster label)
 *
 * Pure. No I/O. No DB writes. No LLM. No mutation of input packet.
 */

import { newElementKey } from "@/domains/pages/extractors/element-key";
import { tokenizeForMatch } from "../../page-inventory";
import type { SpecificEditEvidencePacket } from "../../specific-edit-evidence";
import type { SpecificEdit } from "../../specific-edit-provider";
import { findUnsupportedBrandClaims } from "../../brand-assertions";
import { titleCase, truncate } from "./_text-utils";

const ACTION_TYPE = "add_h2_section" as const;

export function generateAddH2Section(
  packet: SpecificEditEvidencePacket,
): SpecificEdit[] {
  if (!packet.allowedActionTypes.includes(ACTION_TYPE)) return [];

  const out: SpecificEdit[] = [];

  for (const candidate of packet.ownedPageCandidates) {
    if (!packet.allowedTargetUrls.includes(candidate.url)) continue;

    const existingH2Texts = packet.targetPageElements
      .filter((el) => el.url === candidate.url && el.elementType === "h2")
      .map((el) => (el.elementText ?? "").toLowerCase());

    const edit = pickH2Edit(packet, candidate.url, existingH2Texts);
    if (edit) out.push(edit);
  }

  return out;
}

function pickH2Edit(
  packet: SpecificEditEvidencePacket,
  url: string,
  existingH2TextsLower: string[],
): SpecificEdit | null {
  // Branch 1 — TAKES PRECEDENCE. When a top competitor exists we
  // either propose-or-skip on that signal alone; we do NOT fall
  // through to the cluster-label branch. Reasoning: if the page
  // already addresses the top competitor, that's the strongest
  // available H2 signal saying "this page is angled correctly" — a
  // softer cluster-coverage gap shouldn't produce a noisier add-H2
  // proposal on top of an already-targeted page.
  //
  // T-H2Cleanup (2026-05-08) — the prior template
  // (`Why teams choose us over ${competitorName}`) put the
  // competitor's name directly into customer-facing copy, which
  // `validateCompetitorPublicCopy` rejected at write time. Verified
  // on disk: the audit found the exact string
  // "Why teams choose us over De Mattei Construction" with
  // `not_found_reason: "invalid_competitor_public_copy_pre_w3"`.
  // Two halves of the system disagreeing is wasted work + brand-
  // damaging if a row ever slipped through the validator.
  //
  // The replacement is a buyer-perspective decision-framework H2
  // anchored on the cluster label. The competitor SIGNAL still
  // drives the trigger (this gate stays the same); the competitor
  // NAME stays in the operator-facing `why` field and the
  // structured `evidence` array but never reaches public copy.
  // Validator-safe by construction: no competitor names, no
  // brand-claim superlatives, no em dashes. A defensive guard below
  // also abstains if the composed text would happen to trip
  // `findUnsupportedBrandClaims` (e.g., a cluster label that
  // contains "the best [topic]" or "top-rated").
  const topCompetitor = packet.competitorAngles[0];
  if (topCompetitor) {
    const lowerName = topCompetitor.competitorName.toLowerCase();
    const competitorMentioned = existingH2TextsLower.some((h) =>
      h.includes(lowerName),
    );
    if (competitorMentioned) return null;
    const cluster = packet.clusterLabel?.trim() ?? "";
    if (cluster.length === 0) {
      // No cluster anchor → can't compose a specific buyer-perspective
      // H2 without naming the competitor or fabricating language.
      // Better empty than bad.
      return null;
    }
    const proposed = `What to look for in ${cluster}`;
    // Defense-in-depth: if the cluster label happens to embed a
    // forbidden brand-claim pattern (e.g., "Best Modern Home Builder"
    // when no `ranking_first` brand assertion is supplied), the
    // validator would reject the row. Abstain here so the queue
    // doesn't accumulate dead rows.
    const claimMatches = findUnsupportedBrandClaims(
      proposed,
      packet.brandAssertions,
    );
    if (claimMatches.length > 0) return null;
    return buildH2Edit({
      packet,
      url,
      proposed,
      why:
        `Top competitor "${topCompetitor.competitorName}" is primary on ` +
        `${topCompetitor.promptsWherePrimary} of ${topCompetitor.totalAffectedPrompts} ` +
        `affected prompts. This page lacks a buyer-perspective H2 ` +
        `addressing how to evaluate ${cluster}; adding one creates a ` +
        `section the operator can fill with comparison-angle content ` +
        `without naming competitors in customer-facing copy.`,
      evidence: [
        { type: "competitor", competitorName: topCompetitor.competitorName },
        { type: "owned_page", url },
      ],
    });
  }

  // Branch 2 — fires only when there is NO top competitor signal at all.
  if (packet.clusterLabel) {
    const clusterTokens = tokenizeForMatch(packet.clusterLabel);
    if (clusterTokens.length > 0) {
      const clusterTokenSet = new Set(clusterTokens);
      const anyH2HasCluster = existingH2TextsLower.some((h) => {
        const h2Tokens = new Set(tokenizeForMatch(h));
        for (const t of clusterTokenSet) if (h2Tokens.has(t)) return true;
        return false;
      });
      if (!anyH2HasCluster) {
        const proposed = `${titleCase(packet.clusterLabel)}: what to know`;
        return buildH2Edit({
          packet,
          url,
          proposed,
          why:
            `No existing H2 covers the cluster theme "${packet.clusterLabel}" ` +
            `that AI uses when answering affected prompts.`,
          evidence: [
            ...packet.affectedPrompts.map((p) => ({
              type: "prompt" as const,
              promptId: p.promptId,
            })),
            { type: "owned_page", url },
          ],
        });
      }
    }
  }

  return null;
}

function buildH2Edit(args: {
  packet: SpecificEditEvidencePacket;
  url: string;
  proposed: string;
  why: string;
  evidence: SpecificEdit["evidence"];
}): SpecificEdit {
  const elementKey = newElementKey("h2", args.proposed);
  return {
    actionType: ACTION_TYPE,
    targetUrl: args.url,
    targetElement: {
      elementKey,
      displayLabel: `H2 heading (new): "${truncate(args.proposed, 60)}"`,
      currentText: null,
      proposedText: args.proposed,
    },
    why: args.why,
    evidence: args.evidence,
    expectedImpact:
      "Give AI a heading-level anchor for this angle so retrieval " +
      "links the cluster intent to a specific section.",
    difficulty: "low",
    confidence: "medium",
    measurementPlan:
      "Re-poll affected prompts at T+7 / T+14; compare answer-structure " +
      "distribution and owned-page citation share.",
    risks: [
      "An H2 alone isn't enough — the section beneath it must answer the " +
        "implied question. Operator should draft 2-4 paragraphs of body " +
        "copy when accepting.",
    ],
    source: "deterministic",
    providerName: "deterministic",
    model: null,
    costUsd: null,
  };
}
