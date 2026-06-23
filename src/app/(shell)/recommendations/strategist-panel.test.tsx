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
      source: "llm" as const,
      strategist: reasoning,
      evidenceSupports: ["Google Search demand"],
      evidenceMissing: [],
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
      source: "llm" as const,
      strategist: reasoning,
      evidenceSupports: ["Google Search demand"],
      evidenceMissing: [],
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
      source: "llm" as const,
      strategist: reasoning,
      evidenceSupports: ["Google Search demand"],
      evidenceMissing: [],
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
    expect(html).toContain("Things to double-check");
    expect(html).toContain("confirm this is the strongest target page");
    expect(html).toContain("Claims that may not hold up");
    expect(html).toContain("What would make this high-confidence");
    expect(html).toContain("Connect Microsoft Clarity");
  });
});

describe("StrategistPanel — visible deterministic fallback (trust audit C)", () => {
  const deterministicResult: StrategistActionResult = {
    source: "deterministic",
    strategist: {
      ...reasoning,
      alternativesConsidered: [], // deterministic can't generate these
      whyNotAlternatives: [],
      risks: [],
    },
    enforcedConfidence: "medium",
    enforcedApprove: true,
    gateNotes: ["Grounded in Google Search demand."],
    criticReview: null,
    evidenceSupports: ["Google Search demand", "Keyword rankings"],
    evidenceMissing: ["On-page behaviour (connect Microsoft Clarity)"],
  };

  it("renders the VISIBLE fallback banner (not silent) when the LLM is unavailable", () => {
    const html = renderToStaticMarkup(<StrategistPanel result={deterministicResult} />);
    expect(html).toContain('data-recommendation-detail-strategist-fallback="true"');
    expect(html).toContain("Expert (AI) reasoning is unavailable");
    expect(html).toContain('data-recommendation-detail-strategist-source="deterministic"');
    expect(html).toContain("Beacon&#x27;s read");
  });

  it("surfaces the evidence receipt + missing evidence in the fallback", () => {
    const html = renderToStaticMarkup(<StrategistPanel result={deterministicResult} />);
    expect(html).toContain("What backs this");
    expect(html).toContain("Google Search demand");
    expect(html).toContain('data-recommendation-detail-strategist-missing="true"');
    expect(html).toContain("On-page behaviour");
  });

  it("the fallback shows NO unsupported AI-citation claims", () => {
    const html = renderToStaticMarkup(<StrategistPanel result={deterministicResult} />);
    expect(html).not.toMatch(/AI answers? (?:start )?cit/i);
    expect(html).not.toMatch(/will (?:be )?cite/i);
  });

  it("a rejected deterministic verdict still shows ONLY the caution", () => {
    const html = renderToStaticMarkup(
      <StrategistPanel
        result={{ ...deterministicResult, enforcedConfidence: "rejected", enforcedApprove: false }}
      />,
    );
    expect(html).toContain("Not a confident target");
    expect(html).toContain('data-recommendation-detail-strategist-fallback="true"');
    expect(html).not.toContain("already ranks near the top");
  });
});
