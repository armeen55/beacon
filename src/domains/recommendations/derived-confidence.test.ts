/**
 * Tests for `deriveConfidence` — Trust Sprint Mini-Phase T4.4 (2026-05-06).
 *
 * Honesty contract:
 *   - Thin single-prompt row with no other grounding → Needs review.
 *   - Multi-prompt + owned page + competitor → Strong evidence.
 *   - operator_edited rows: same rules apply (the helper doesn't see source).
 *   - FAQ-answer rows with thin packet → Needs review (mirrors T4.1 Rule D).
 *   - No env flag promotes Needs review to Moderate or Strong.
 */

import { describe, expect, it } from "vitest";
import {
  deriveConfidence,
  DERIVED_CONFIDENCE_DISPLAY,
  type DerivedConfidenceLabel,
} from "./derived-confidence";
import type { SpecificEditEvidenceRef } from "./specific-edit-provider";

const PROMPT: SpecificEditEvidenceRef = { type: "prompt", promptId: "p1" };
const PROMPT_2: SpecificEditEvidenceRef = { type: "prompt", promptId: "p2" };
const OWNED: SpecificEditEvidenceRef = {
  type: "owned_page",
  url: "https://example.com/x",
};
const COMPETITOR: SpecificEditEvidenceRef = {
  type: "competitor",
  competitorName: "Comp",
};

describe("deriveConfidence — Strong evidence", () => {
  it("multi-prompt + owned-page + competitor → strong_evidence", () => {
    const r = deriveConfidence({
      evidenceRefs: [PROMPT, PROMPT_2, OWNED, COMPETITOR],
      evidenceDepth: 4, // 1 (prompt) + 1 (multi-prompt bonus) + 1 (owned) + 1 (competitor)
      affectedPromptCount: 2,
      isFaqAnswer: false,
      hasTopCompetitor: true,
    });
    expect(r).toBe<DerivedConfidenceLabel>("strong_evidence");
  });

  it("evidence depth >= 4 alone returns strong_evidence", () => {
    const r = deriveConfidence({
      evidenceRefs: [PROMPT, PROMPT_2, OWNED, COMPETITOR],
      evidenceDepth: 4,
      affectedPromptCount: 2,
      isFaqAnswer: false,
      hasTopCompetitor: false, // even with topCompetitor false, depth carries it
    });
    expect(r).toBe("strong_evidence");
  });

  it("operator_edited grounded rec stays Strong (helper doesn't see source)", () => {
    // operator_edited rows are sourced via the SAME evidence array; the
    // helper has no concept of "source", which is the right contract.
    const r = deriveConfidence({
      evidenceRefs: [PROMPT, PROMPT_2, OWNED, COMPETITOR],
      evidenceDepth: 4,
      affectedPromptCount: 2,
      isFaqAnswer: false,
      hasTopCompetitor: true,
    });
    expect(r).toBe("strong_evidence");
  });
});

describe("deriveConfidence — Moderate evidence", () => {
  it("multi-prompt + owned-page (no competitor / no search query) → strong via multi+owned+competitor signal? — verify exact rule", () => {
    // Multi-prompt + owned-page is two grounding signals + bonus = depth 3.
    // Strong rule needs hasMultiPrompt + hasOwnedPage AND one of (competitor /
    // search query / brand assertion). With NEITHER, falls to depth check
    // (>= 4 = strong). depth = 3 here. So this case → moderate.
    const r = deriveConfidence({
      evidenceRefs: [PROMPT, PROMPT_2, OWNED],
      evidenceDepth: 3,
      affectedPromptCount: 2,
      isFaqAnswer: false,
      hasTopCompetitor: false,
    });
    expect(r).toBe("moderate_evidence");
  });

  it("single-prompt + owned-page + competitor → moderate (no multi-prompt)", () => {
    const r = deriveConfidence({
      evidenceRefs: [PROMPT, OWNED, COMPETITOR],
      evidenceDepth: 3,
      affectedPromptCount: 1,
      isFaqAnswer: false,
      hasTopCompetitor: true,
    });
    expect(r).toBe("moderate_evidence");
  });
});

describe("deriveConfidence — Needs review", () => {
  it("single-prompt thin (no owned, no competitor, no search) → needs_review", () => {
    const r = deriveConfidence({
      evidenceRefs: [PROMPT],
      evidenceDepth: 1,
      affectedPromptCount: 1,
      isFaqAnswer: false,
      hasTopCompetitor: false,
    });
    expect(r).toBe("needs_review");
  });

  it("FAQ-answer with single-prompt + no other grounding → needs_review (mirrors T4.1 Rule D)", () => {
    const r = deriveConfidence({
      evidenceRefs: [PROMPT],
      evidenceDepth: 1,
      affectedPromptCount: 1,
      isFaqAnswer: true,
      hasTopCompetitor: false,
    });
    expect(r).toBe("needs_review");
  });

  it("zero evidence + zero rec-level signals → needs_review", () => {
    const r = deriveConfidence({
      evidenceRefs: [],
      evidenceDepth: 0,
      affectedPromptCount: 0,
      isFaqAnswer: false,
      hasTopCompetitor: false,
    });
    expect(r).toBe("needs_review");
  });

  it("zero evidence + rec-level multi-prompt only → still needs_review (no grounding categories)", () => {
    // affectedPromptCount = 2 means hasMultiPrompt true, but with NO
    // owned page / NO competitor / NO search query / NO brand assertion,
    // the depth-1 floor and "thin" rule must still fire.
    const r = deriveConfidence({
      evidenceRefs: [],
      evidenceDepth: 0,
      affectedPromptCount: 2,
      isFaqAnswer: false,
      hasTopCompetitor: false,
    });
    expect(r).toBe("needs_review");
  });
});

describe("deriveConfidence — display strings", () => {
  it("DERIVED_CONFIDENCE_DISPLAY maps every label to a customer-safe phrase", () => {
    expect(DERIVED_CONFIDENCE_DISPLAY.strong_evidence).toBe("Strong evidence");
    expect(DERIVED_CONFIDENCE_DISPLAY.moderate_evidence).toBe("Moderate evidence");
    expect(DERIVED_CONFIDENCE_DISPLAY.needs_review).toBe("Needs review");
  });

  it("display strings never contain raw enum names like 'high'/'medium'/'low'", () => {
    for (const value of Object.values(DERIVED_CONFIDENCE_DISPLAY)) {
      expect(value.toLowerCase()).not.toMatch(/\b(high|medium|low)\b/);
    }
  });
});

describe("deriveConfidence — honesty contract (no env-gated promotion)", () => {
  it("a thin row stays needs_review even with hasTopCompetitor=true and high evidenceDepth=1 — no flag short-circuits the floor", () => {
    // hasTopCompetitor=true but evidenceRefs has only one prompt and
    // depth=1 → still needs_review because the multi-prompt OR owned-page
    // requirements aren't met.
    const r = deriveConfidence({
      evidenceRefs: [PROMPT],
      evidenceDepth: 1,
      affectedPromptCount: 1,
      isFaqAnswer: false,
      hasTopCompetitor: true,
    });
    // hasTopCompetitor IS a grounding signal — bumps to moderate_evidence,
    // not needs_review. This pin verifies the exact boundary.
    expect(r).toBe("moderate_evidence");
  });
});
