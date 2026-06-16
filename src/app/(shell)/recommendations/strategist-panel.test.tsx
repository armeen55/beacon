/**
 * Expert-rec-engine PHASE I (2026-06-16) — StrategistPanel render contract.
 * SSR (renderToStaticMarkup) against the real exported pure panel:
 *   • an APPROVED verdict renders the full expert reasoning + the confidence
 *     chip;
 *   • a REJECTED verdict renders ONLY the honest caution (the persuasive
 *     reasoning is suppressed) — the deterministic gate governs the surface.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { StrategistPanel } from "./[id]/strategist-act";
import type { StrategistActionResult } from "./[id]/llm-strategist-action";

const reasoning = {
  opportunitySummary: "This page already ranks near the top for a high-demand query.",
  whyThisNow: "It is in striking distance, so a sharper title is the fastest lever.",
  bestAction: "Rewrite the title to lead with the exact phrase searchers use.",
  alternativesConsidered: ["Rewrite the body copy", "Build a new page"],
  whyNotAlternatives: ["The page already ranks", "A new page splits authority"],
  expectedOutcome: "More clicks from searches the page already appears for.",
  riskLevel: "low" as const,
  risks: ["A title change can briefly shift ranking while it re-crawls."],
};

describe("StrategistPanel", () => {
  it("APPROVED → renders the expert reasoning + confidence chip", () => {
    const result: StrategistActionResult = {
      strategist: reasoning,
      enforcedConfidence: "high",
      enforcedApprove: true,
      gateNotes: ["Strong evidence and intent fit."],
      criticReview: null,
    };
    const html = renderToStaticMarkup(<StrategistPanel result={result} />);
    expect(html).toContain("High confidence");
    expect(html).toContain("already ranks near the top");
    expect(html).toContain("Why this beats the alternatives");
    expect(html).toContain("A new page splits authority");
    expect(html).toContain('data-recommendation-detail-strategist-summary="true"');
    // not the rejection caution
    expect(html).not.toContain("not a confident target");
  });

  it("REJECTED → renders ONLY the caution, suppresses the reasoning", () => {
    const result: StrategistActionResult = {
      strategist: reasoning,
      enforcedConfidence: "rejected",
      enforcedApprove: false,
      gateNotes: [
        "Page-topic intent-fit found the query is the wrong target for this page.",
      ],
      criticReview: null,
    };
    const html = renderToStaticMarkup(<StrategistPanel result={result} />);
    expect(html).toContain("Not a confident target");
    expect(html).toContain("wrong target for this page");
    expect(html).toContain('data-recommendation-detail-strategist-caution="true"');
    // the persuasive reasoning must NOT leak through on a rejected verdict
    expect(html).not.toContain("already ranks near the top");
    expect(html).not.toContain("Why this beats the alternatives");
  });

  it("renders the Adversarial QA panel when a critic review is present", () => {
    const result: StrategistActionResult = {
      strategist: reasoning,
      enforcedConfidence: "medium",
      enforcedApprove: true,
      gateNotes: ["Moderate evidence and intent fit."],
      criticReview: {
        criticVerdict: "lower_confidence",
        confidenceCeiling: "medium",
        unsupportedClaims: ["The 'already ranks' claim isn't tied to a specific number."],
        evidenceGaps: ["No on-page behaviour data for this page."],
        queryPageMismatchRisks: [],
        copyRisks: [],
        publishingRisks: [],
        factualRisks: [],
        whatWouldMakeThisHighConfidence: ["Connect Microsoft Clarity to confirm on-page behaviour."],
        humanReviewNote: "Solid direction, but confirm this is the strongest target page.",
      },
    };
    const html = renderToStaticMarkup(<StrategistPanel result={result} />);
    expect(html).toContain('data-recommendation-detail-adversarial-qa="true"');
    expect(html).toContain("Adversarial QA");
    expect(html).toContain("confirm this is the strongest target page");
    expect(html).toContain("Unsupported claims");
    expect(html).toContain("What would make this high-confidence");
    expect(html).toContain("Connect Microsoft Clarity");
  });
});
