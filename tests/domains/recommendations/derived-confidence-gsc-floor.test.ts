/**
 * Pivot 2026-06-13 — first-party Google Search demand floors the
 * derived-confidence label so a provably-trafficked page never reads
 * "Needs more evidence". GSC demand can only RAISE the label, never
 * lower an already-strong AEO grounding. Thresholds mirror
 * priorityForRow (≥1000 → Strong; ≥200 → at least Moderate).
 */

import { describe, it, expect } from "vitest";

import {
  deriveConfidence,
  type DeriveConfidenceInput,
} from "@/domains/recommendations/derived-confidence";

// A maximally-thin row — AEO rubric alone returns "needs_review".
const THIN: DeriveConfidenceInput = {
  evidenceRefs: [],
  evidenceDepth: 0,
  affectedPromptCount: 0,
  isFaqAnswer: false,
  hasTopCompetitor: false,
};

// A row whose AEO grounding already earns "strong_evidence".
const STRONG_AEO: DeriveConfidenceInput = {
  evidenceRefs: [],
  evidenceDepth: 5, // ≥4 → strong on AEO alone
  affectedPromptCount: 3,
  isFaqAnswer: false,
  hasTopCompetitor: true,
};

describe("deriveConfidence — first-party GSC demand floor", () => {
  it("no GSC signal → unchanged AEO behavior (thin → needs_review)", () => {
    expect(deriveConfidence(THIN)).toBe("needs_review");
    expect(deriveConfidence({ ...THIN, gscImpressions: undefined })).toBe(
      "needs_review",
    );
  });

  it("heavy demand (≥1000 impressions) → strong, even on otherwise-thin AEO", () => {
    expect(deriveConfidence({ ...THIN, gscImpressions: 9137 })).toBe(
      "strong_evidence",
    );
  });

  it("meaningful demand (≥200) rescues a thin row from needs_review → moderate", () => {
    expect(deriveConfidence({ ...THIN, gscImpressions: 200 })).toBe(
      "moderate_evidence",
    );
    expect(deriveConfidence({ ...THIN, gscImpressions: 626 })).toBe(
      "moderate_evidence",
    );
  });

  it("below the floor (<200) does NOT rescue a thin row", () => {
    expect(deriveConfidence({ ...THIN, gscImpressions: 199 })).toBe(
      "needs_review",
    );
    expect(deriveConfidence({ ...THIN, gscImpressions: 0 })).toBe(
      "needs_review",
    );
  });

  it("GSC demand never LOWERS an already-strong AEO label", () => {
    // Strong AEO + tiny/no demand stays strong.
    expect(deriveConfidence(STRONG_AEO)).toBe("strong_evidence");
    expect(deriveConfidence({ ...STRONG_AEO, gscImpressions: 5 })).toBe(
      "strong_evidence",
    );
  });
});
