/**
 * Act 2 "Why this matters" narrative synthesis — unit tests.
 *
 * Pins the deterministic, honest, white-label synthesis contract:
 *   (a) full evidence → multi-sentence with query + competitor + gap
 *   (b) prompt-only AEO rec (no competitor, no GSC) → "When AI
 *       assistants answer …" lead + gap clause, NO hedge
 *   (c) zero evidence → single calm fallback sentence
 *   (d) white-label: never contains "Profound"
 *   (e) never invents numbers
 */

import { describe, expect, it } from "vitest";

import {
  composeWhyThisMatters,
  crossSourceConnection,
  WHY_THIS_MATTERS_EMPTY,
  type WhyThisMattersInput,
} from "@/domains/recommendations/why-this-matters-narrative";
import type { EvidenceLine } from "@/domains/recommendation-intelligence/evidence-summary";

function makeInput(
  overrides: Partial<WhyThisMattersInput> = {},
): WhyThisMattersInput {
  return {
    actionType: "add_faq",
    targetLabel: "Whole Home Remodel page",
    why: null,
    affectedPromptTexts: [],
    competitor: null,
    gscEvidenceLines: [],
    clarityEvidenceLines: [],
    aeoEvidenceLines: [],
    promptCount: 0,
    observationCount: 0,
    derivedConfidence: "moderate_evidence",
    ...overrides,
  };
}

const GSC_LINE: EvidenceLine = {
  key: "headline_query",
  value: "“whole home remodel cost”",
  label: "1,800 times shown · you rank #6 (striking distance)",
  detail:
    "You already rank #6 for “whole home remodel cost” — shown 1,800 times in the last 90 days, just short of page one. Reaching the top 3 could win about 120 more visits over 90 days.",
};

const AEO_LINE: EvidenceLine = {
  key: "aeo_answer_gap",
  value: "Not cited yet",
  label: "8 AI answers cite a rival, not you",
  detail:
    "AI assistants answer this topic citing Acme across about 8 answers — you're not cited yet. Add a clear, quotable answer block on your site for this topic so AI engines can cite you instead.",
};

const CLARITY_LINE: EvidenceLine = {
  key: "clarity_script_errors",
  value: "9%",
  label: "of sessions hit a page error (520 sessions)",
  detail:
    "This page throws an error in 9% of visits (520 sessions tracked). Errors break the page for visitors — and AI assistants can't read a page that fails to load — so fixing it protects how often you're recommended.",
};

describe("composeWhyThisMatters", () => {
  it("(a) full evidence → multi-sentence with query + competitor + gap", () => {
    const out = composeWhyThisMatters(
      makeInput({
        actionType: "add_section",
        targetLabel: "Whole Home Remodel page",
        affectedPromptTexts: ["whole home remodel cost bay area"],
        competitor: { name: "De Mattei", primaryPct: 0.42 },
        gscEvidenceLines: [GSC_LINE],
        promptCount: 3,
        observationCount: 12,
        derivedConfidence: "strong_evidence",
      }),
    );

    // Lead is the cross-source CONNECTION (search demand + AEO gap both
    // implicate this page) — the BLUF "why this is the high-leverage card";
    // the concrete GSC "why now" detail (exact query + rank) follows it.
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out[0]).toContain("two fronts");

    const joined = out.join(" ");
    // The specific GSC fact survives the cap, just below the connection lead.
    expect(joined).toContain("whole home remodel cost");
    expect(joined).toContain("#6");
    // Competitive-pressure clause with the real share.
    expect(joined).toContain("De Mattei shows up in 42% of those answers.");
    // Gap clause derived from action type + target label.
    expect(joined).toContain(
      "Your Whole Home Remodel page has no section addressing this",
    );
    // Never the generic confidence hedge when evidence is present.
    expect(joined).not.toContain("isn't fully clear yet");
  });

  it("(b) prompt-only AEO rec (no competitor, no GSC) → 'When AI assistants answer …' lead + gap clause, NO hedge", () => {
    const out = composeWhyThisMatters(
      makeInput({
        actionType: "add_faq",
        targetLabel: "Services page",
        affectedPromptTexts: ["best general contractor near me"],
        competitor: null,
        gscEvidenceLines: [],
        aeoEvidenceLines: [],
        promptCount: 2,
        observationCount: 5,
        derivedConfidence: "moderate_evidence",
      }),
    );

    expect(out[0]).toBe(
      "When AI assistants answer “best general contractor near me”, they don't currently recommend your site.",
    );
    const joined = out.join(" ");
    expect(joined).toContain(
      "Your Services page has no FAQ answering this directly",
    );
    // No generic "picture isn't fully clear yet" hedge in the synthesis.
    expect(joined).not.toContain("isn't fully clear yet");
    expect(joined).not.toContain("Some signals are present");
  });

  it("folds the white-label answer-engine gap as the lead when present (no competitor double-up)", () => {
    const out = composeWhyThisMatters(
      makeInput({
        actionType: "add_section",
        targetLabel: "Services page",
        // A competitor IS present, but the AEO line already carries the
        // rival narrative — the competitor clause must be suppressed.
        competitor: { name: "Acme", primaryPct: 0.5 },
        aeoEvidenceLines: [AEO_LINE],
        observationCount: 8,
      }),
    );
    const joined = out.join(" ");
    expect(out[0]).toContain("AI assistants answer this topic");
    // White-label: the vendor name is never the rendered framing token.
    expect(joined).not.toContain("Profound");
    // No redundant "Acme shows up in 50% of those answers" clause.
    expect(joined).not.toContain("shows up in 50%");
    expect(joined).not.toContain("cited in 50%");
  });

  it("(c) zero evidence → single calm fallback sentence", () => {
    const out = composeWhyThisMatters(makeInput());
    expect(out).toEqual([WHY_THIS_MATTERS_EMPTY]);
    expect(out).toHaveLength(1);
  });

  it("zero structured evidence but a guarded `why` exists → surfaces that single sentence", () => {
    const out = composeWhyThisMatters(
      makeInput({
        why: "This page is the closest match for the topic but isn't winning yet.",
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("closest match for the topic");
  });

  it("(d) white-label: never contains 'Profound' even with AEO + clarity + gsc lines", () => {
    const out = composeWhyThisMatters(
      makeInput({
        gscEvidenceLines: [GSC_LINE],
        aeoEvidenceLines: [AEO_LINE],
        clarityEvidenceLines: [CLARITY_LINE],
        competitor: { name: "De Mattei", primaryPct: 0.42 },
        affectedPromptTexts: ["whole home remodel cost"],
        promptCount: 3,
        observationCount: 12,
      }),
    );
    const joined = out.join(" ");
    expect(joined).not.toContain("Profound");
    expect(joined.toLowerCase()).not.toContain("profound");
  });

  it("(e) never invents numbers — only emits digits that appear in the inputs", () => {
    const out = composeWhyThisMatters(
      makeInput({
        actionType: "add_section",
        targetLabel: "Services page",
        affectedPromptTexts: ["modern home builder atherton"],
        competitor: { name: "De Mattei", primaryPct: 0.42 },
        promptCount: 3,
        observationCount: 12,
        derivedConfidence: "moderate_evidence",
      }),
    );
    const joined = out.join(" ");
    // The only number that should appear is the competitor's 42% share
    // (the one number actually in the inputs — no prompt text here has
    // digits, no GSC lines were passed).
    const numbers = joined.match(/\d+/g) ?? [];
    expect(numbers).toEqual(["42"]);
  });

  it("includes the Clarity friction fact as the closing sentence when present", () => {
    const out = composeWhyThisMatters(
      makeInput({
        actionType: "technical_fix",
        targetLabel: "Available Homes page",
        clarityEvidenceLines: [CLARITY_LINE],
        observationCount: 0,
        promptCount: 0,
      }),
    );
    const joined = out.join(" ");
    expect(joined).toContain("throws an error in 9% of visits");
  });

  it("caps the synthesis at 4 sentences", () => {
    const out = composeWhyThisMatters(
      makeInput({
        actionType: "add_section",
        targetLabel: "Whole Home Remodel page",
        affectedPromptTexts: ["whole home remodel cost"],
        competitor: { name: "De Mattei", primaryPct: 0.42 },
        gscEvidenceLines: [GSC_LINE],
        clarityEvidenceLines: [CLARITY_LINE],
        promptCount: 3,
        observationCount: 12,
      }),
    );
    expect(out.length).toBeLessThanOrEqual(4);
  });

  it("keeps each sentence within the scannable soft cap (≤ ~161 chars)", () => {
    const out = composeWhyThisMatters(
      makeInput({
        gscEvidenceLines: [GSC_LINE],
        competitor: { name: "De Mattei", primaryPct: 0.42 },
        affectedPromptTexts: ["whole home remodel cost"],
        promptCount: 3,
        observationCount: 12,
      }),
    );
    for (const sentence of out) {
      expect(sentence.length).toBeLessThanOrEqual(161);
    }
  });
});

describe("crossSourceConnection — pro-grade synthesis when ≥2 source families implicate one page", () => {
  it("returns null for a single source family (per-source clauses cover it)", () => {
    expect(crossSourceConnection({ search: true, behavior: false, aeo: false })).toBeNull();
    expect(crossSourceConnection({ search: false, behavior: false, aeo: false })).toBeNull();
  });
  it("search + behavior → connects friction to the click loss", () => {
    const s = crossSourceConnection({ search: true, behavior: true, aeo: false });
    expect(s).toContain("losing Google clicks");
    expect(s).toContain("friction");
  });
  it("search + aeo → 'slipping on two fronts'", () => {
    const s = crossSourceConnection({ search: true, behavior: false, aeo: true });
    expect(s).toContain("two fronts");
    expect(s).toContain("AI assistants");
  });
  it("behavior + aeo → friction + AI, helps both", () => {
    const s = crossSourceConnection({ search: false, behavior: true, aeo: true });
    expect(s).toContain("friction");
    expect(s).toContain("AI assistants");
  });
  it("all three → compounds across all fronts", () => {
    const s = crossSourceConnection({ search: true, behavior: true, aeo: true });
    expect(s).toContain("highest-leverage");
  });
  it("white-label + no invented numbers in any connection sentence", () => {
    for (const f of [
      { search: true, behavior: true, aeo: false },
      { search: true, behavior: false, aeo: true },
      { search: false, behavior: true, aeo: true },
      { search: true, behavior: true, aeo: true },
    ]) {
      const s = crossSourceConnection(f)!;
      expect(s).not.toMatch(/profound|chatgpt|gemini|perplexity|claude/i);
      expect(s).not.toMatch(/\d/); // synthesis asserts no number of its own
    }
  });
});

describe("composeWhyThisMatters — leads with the cross-source connection when multi-source", () => {
  it("GSC + Clarity present → first sentence is the connecting insight", () => {
    const out = composeWhyThisMatters(
      makeInput({
        gscEvidenceLines: [GSC_LINE],
        clarityEvidenceLines: [CLARITY_LINE],
      }),
    );
    expect(out[0]).toContain("both losing Google clicks and frustrating visitors");
    // the per-source specifics still follow
    expect(out.length).toBeGreaterThan(1);
  });
  it("single source (GSC only) → NO connection sentence (leads with the GSC fact)", () => {
    const out = composeWhyThisMatters(makeInput({ gscEvidenceLines: [GSC_LINE] }));
    expect(out[0]).not.toContain("two fronts");
    expect(out[0]).not.toContain("both losing");
  });
});
