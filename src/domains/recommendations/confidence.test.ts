/**
 * W3 Step 3.3 (2026-05-01) — confidence rubric tests.
 *
 * Locks the trust contract before the W3 Step 3.4 LLM provider
 * activates: HIGH must be hard to earn, LOW gates short-circuit
 * unambiguously, MEDIUM is the catch-all. Determinism is mandatory —
 * downstream caches key on the verdict.
 *
 * Pure-function tests. No I/O.
 */

import { describe, expect, it } from "vitest";

import {
  computeRecConfidence,
  HIGH_MIN_AFFECTED_PROMPTS,
  HIGH_MIN_EVIDENCE_REFS,
  type ComputeRecConfidenceArgs,
  type ConfidenceEditInput,
} from "./confidence";

// ── Fixture helpers ───────────────────────────────────────────────────────

/**
 * Baseline args that satisfy every HIGH dimension. Individual tests
 * override just the field they're exercising. This is the only path
 * through the rubric that returns HIGH.
 */
function highArgs(
  overrides: Partial<ComputeRecConfidenceArgs> = {},
): ComputeRecConfidenceArgs {
  return {
    affectedPromptCount: HIGH_MIN_AFFECTED_PROMPTS, // 2
    resolverTier: "adjudicated",
    resolutionConfidence: "high",
    needsHumanReview: false,
    evidenceRefCount: HIGH_MIN_EVIDENCE_REFS, // 2
    edits: [makeEdit({ confidence: "high" }), makeEdit({ confidence: "high" })],
    hasAiSearchSignal: true,
    hasCompetitorPageBlueprints: true,
    competitorNames: ["De Mattei Construction"],
    ...overrides,
  };
}

function makeEdit(
  overrides: Partial<ConfidenceEditInput> = {},
): ConfidenceEditInput {
  return {
    proposed_text: "We deliver full-service custom builds and renovations.",
    confidence: "high",
    target_element_key: "h2[new]:abc",
    ...overrides,
  };
}

// ── HIGH path ─────────────────────────────────────────────────────────────

describe("computeRecConfidence — HIGH path", () => {
  it("returns HIGH when every dimension passes", () => {
    const verdict = computeRecConfidence(highArgs());
    expect(verdict.confidence).toBe("high");
    expect(verdict.reasons).toContain("multi_prompt_signal");
    expect(verdict.reasons).toContain("adjudicated_or_inventory_tier");
    expect(verdict.reasons).toContain("all_edits_high_confidence");
    expect(verdict.reasons).toContain("resolution_high_confidence");
    expect(verdict.reasons).toContain("sufficient_evidence_refs");
    // Either grounding code is acceptable; both can land.
    expect(
      verdict.reasons.includes("grounded_in_search_signal") ||
        verdict.reasons.includes("grounded_in_competitor_blueprints"),
    ).toBe(true);
  });

  it("HIGH still passes with only aiSearchSignal grounding (no blueprints)", () => {
    const verdict = computeRecConfidence(
      highArgs({
        hasAiSearchSignal: true,
        hasCompetitorPageBlueprints: false,
      }),
    );
    expect(verdict.confidence).toBe("high");
    expect(verdict.reasons).toContain("grounded_in_search_signal");
    expect(verdict.reasons).not.toContain("grounded_in_competitor_blueprints");
  });

  it("HIGH still passes with only blueprints grounding (no search signal)", () => {
    const verdict = computeRecConfidence(
      highArgs({
        hasAiSearchSignal: false,
        hasCompetitorPageBlueprints: true,
      }),
    );
    expect(verdict.confidence).toBe("high");
    expect(verdict.reasons).toContain("grounded_in_competitor_blueprints");
    expect(verdict.reasons).not.toContain("grounded_in_search_signal");
  });

  it("HIGH passes for inventory tier when other dimensions are met", () => {
    const verdict = computeRecConfidence(
      highArgs({ resolverTier: "inventory" }),
    );
    expect(verdict.confidence).toBe("high");
    expect(verdict.reasons).toContain("adjudicated_or_inventory_tier");
  });
});

// ── LOW gates (early returns) ─────────────────────────────────────────────

describe("computeRecConfidence — LOW gates", () => {
  it("LOW: affectedPromptCount === 0", () => {
    const verdict = computeRecConfidence(
      highArgs({ affectedPromptCount: 0 }),
    );
    expect(verdict.confidence).toBe("low");
    expect(verdict.reasons).toEqual(["no_affected_prompts"]);
  });

  it("LOW: needsHumanReview === true", () => {
    const verdict = computeRecConfidence(
      highArgs({ needsHumanReview: true }),
    );
    expect(verdict.confidence).toBe("low");
    expect(verdict.reasons).toEqual(["needs_human_review"]);
  });

  it("LOW: zero edits", () => {
    const verdict = computeRecConfidence(highArgs({ edits: [] }));
    expect(verdict.confidence).toBe("low");
    expect(verdict.reasons).toEqual(["no_edits"]);
  });

  it("LOW: any edit with confidence === 'low'", () => {
    const verdict = computeRecConfidence(
      highArgs({
        edits: [
          makeEdit({ confidence: "high" }),
          makeEdit({ confidence: "low" }),
        ],
      }),
    );
    expect(verdict.confidence).toBe("low");
    expect(verdict.reasons).toEqual(["edit_low_confidence"]);
  });

  it("LOW: any edit with placeholder text in proposed_text", () => {
    const verdict = computeRecConfidence(
      highArgs({
        edits: [
          makeEdit({
            proposed_text: "Draft answer (operator: rewrite). Anchor on: foo.",
          }),
        ],
      }),
    );
    expect(verdict.confidence).toBe("low");
    expect(verdict.reasons).toEqual(["edit_placeholder_text"]);
  });

  it("LOW: TBD placeholder", () => {
    const verdict = computeRecConfidence(
      highArgs({
        edits: [makeEdit({ proposed_text: "Pricing: TBD" })],
      }),
    );
    expect(verdict.confidence).toBe("low");
    expect(verdict.reasons).toEqual(["edit_placeholder_text"]);
  });

  it("LOW: competitor name leaks into proposed_text (defense-in-depth)", () => {
    const verdict = computeRecConfidence(
      highArgs({
        edits: [
          makeEdit({
            proposed_text:
              "Why teams choose us over De Mattei Construction for kitchen remodels.",
          }),
        ],
        competitorNames: ["De Mattei Construction"],
      }),
    );
    expect(verdict.confidence).toBe("low");
    expect(verdict.reasons).toEqual(["competitor_name_leak_in_copy"]);
  });

  it("LOW: tier === 'deterministic_only'", () => {
    const verdict = computeRecConfidence(
      highArgs({ resolverTier: "deterministic_only" }),
    );
    expect(verdict.confidence).toBe("low");
    expect(verdict.reasons).toEqual(["tier_deterministic_only"]);
  });

  it("LOW: resolutionConfidence === 'low'", () => {
    const verdict = computeRecConfidence(
      highArgs({ resolutionConfidence: "low" }),
    );
    expect(verdict.confidence).toBe("low");
    expect(verdict.reasons).toEqual(["resolution_low_confidence"]);
  });

  it("LOW gate priority — needs_human_review fires before edit checks", () => {
    // Both gates would fire (no edits + needsHumanReview); the
    // earlier-checked gate wins.
    const verdict = computeRecConfidence(
      highArgs({ needsHumanReview: true, edits: [] }),
    );
    expect(verdict.reasons).toEqual(["needs_human_review"]);
  });

  it("LOW: short competitor names (<3 chars) do NOT trigger leak (avoids noise)", () => {
    // Real concern: "Co" or "In" appearing in normal copy as common
    // English words. The competitor-leak filter skips names < 3 chars.
    const verdict = computeRecConfidence(
      highArgs({
        edits: [
          makeEdit({
            proposed_text:
              "Co-located teams in our process drive ongoing improvements.",
          }),
        ],
        competitorNames: ["Co"],
      }),
    );
    expect(verdict.confidence).toBe("high");
  });
});

// ── MEDIUM path (HIGH-blocker conditions) ─────────────────────────────────

describe("computeRecConfidence — MEDIUM path (HIGH blockers)", () => {
  it("MEDIUM: single-prompt signal", () => {
    const verdict = computeRecConfidence(
      highArgs({ affectedPromptCount: 1 }),
    );
    expect(verdict.confidence).toBe("medium");
    expect(verdict.reasons).toContain("single_prompt_signal");
  });

  it("MEDIUM: observation tier (not adjudicated/inventory)", () => {
    const verdict = computeRecConfidence(
      highArgs({ resolverTier: "observation" }),
    );
    expect(verdict.confidence).toBe("medium");
    expect(verdict.reasons).toContain("tier_observation_only");
  });

  it("MEDIUM: any edit at confidence 'medium'", () => {
    const verdict = computeRecConfidence(
      highArgs({
        edits: [
          makeEdit({ confidence: "high" }),
          makeEdit({ confidence: "medium" }),
        ],
      }),
    );
    expect(verdict.confidence).toBe("medium");
    expect(verdict.reasons).toContain("edit_medium_or_lower_confidence");
  });

  it("MEDIUM: no grounded packet signal (defaults: both false)", () => {
    const verdict = computeRecConfidence(
      highArgs({
        hasAiSearchSignal: false,
        hasCompetitorPageBlueprints: false,
      }),
    );
    expect(verdict.confidence).toBe("medium");
    expect(verdict.reasons).toContain("no_grounded_packet_signal");
  });

  it("MEDIUM: no grounded packet signal (fields omitted entirely)", () => {
    // Cast through a mutable writable view so we can simulate a
    // caller that didn't pass the optional flags at all (delete
    // works at runtime; the readonly modifier is a TS-only guard).
    const args: Record<string, unknown> = { ...highArgs() };
    delete args.hasAiSearchSignal;
    delete args.hasCompetitorPageBlueprints;
    const verdict = computeRecConfidence(
      args as unknown as ComputeRecConfidenceArgs,
    );
    expect(verdict.confidence).toBe("medium");
    expect(verdict.reasons).toContain("no_grounded_packet_signal");
  });

  it("MEDIUM: resolution confidence 'medium' (not 'high')", () => {
    const verdict = computeRecConfidence(
      highArgs({ resolutionConfidence: "medium" }),
    );
    expect(verdict.confidence).toBe("medium");
    expect(verdict.reasons).toContain("resolution_medium_confidence");
  });

  it("MEDIUM: thin evidence refs (below threshold)", () => {
    const verdict = computeRecConfidence(highArgs({ evidenceRefCount: 1 }));
    expect(verdict.confidence).toBe("medium");
    expect(verdict.reasons).toContain("thin_evidence_refs");
  });

  it("MEDIUM: multiple blockers stack, both reported", () => {
    const verdict = computeRecConfidence(
      highArgs({
        affectedPromptCount: 1,
        evidenceRefCount: 1,
      }),
    );
    expect(verdict.confidence).toBe("medium");
    expect(verdict.reasons).toContain("single_prompt_signal");
    expect(verdict.reasons).toContain("thin_evidence_refs");
  });

  it("MEDIUM verdict carries positives that DID land alongside blockers", () => {
    const verdict = computeRecConfidence(
      highArgs({ affectedPromptCount: 1 }), // single-prompt blocker only
    );
    expect(verdict.confidence).toBe("medium");
    // Still got these positives:
    expect(verdict.reasons).toContain("adjudicated_or_inventory_tier");
    expect(verdict.reasons).toContain("all_edits_high_confidence");
    expect(verdict.reasons).toContain("resolution_high_confidence");
    expect(verdict.reasons).toContain("sufficient_evidence_refs");
    // Plus the blocker:
    expect(verdict.reasons).toContain("single_prompt_signal");
  });
});

// ── Determinism ──────────────────────────────────────────────────────────

describe("computeRecConfidence — determinism", () => {
  it("same inputs return the same verdict", () => {
    const args = highArgs();
    const a = computeRecConfidence(args);
    const b = computeRecConfidence(args);
    expect(a).toEqual(b);
  });

  it("verdict is JSON-serializable (logs / debug surfaces)", () => {
    const args = highArgs({ affectedPromptCount: 1 });
    const verdict = computeRecConfidence(args);
    expect(() => JSON.stringify(verdict)).not.toThrow();
  });

  it("reasons array is never empty", () => {
    const cases: ComputeRecConfidenceArgs[] = [
      highArgs(), // HIGH
      highArgs({ affectedPromptCount: 1 }), // MEDIUM
      highArgs({ edits: [] }), // LOW
      highArgs({ needsHumanReview: true }), // LOW
    ];
    for (const args of cases) {
      const verdict = computeRecConfidence(args);
      expect(verdict.reasons.length).toBeGreaterThan(0);
    }
  });
});

// ── Apply-All-HIGH guardrail ──────────────────────────────────────────────

describe("computeRecConfidence — Apply-All-HIGH is NOT a thing", () => {
  it("HIGH means 'likely safe to ship MANUALLY,' never 'auto-apply'", () => {
    // This test is documentation-as-code. The verdict's `confidence`
    // value is a label; the system never grants it auto-apply
    // semantics. If a future change adds an Apply-All-HIGH UX, the
    // operator's W3 §1.5 scope lock requires inspecting 20-30 recs
    // first AND a coordinated update HERE so the rubric's
    // single-shipper-trust intent can't drift silently.
    const verdict = computeRecConfidence(highArgs());
    expect(verdict.confidence).toBe("high");
    // Sanity: a HIGH verdict carries 5+ reasons. If you ship a path
    // that returns HIGH from a single positive signal, you've
    // weakened the rubric and this assertion forces the conversation.
    expect(verdict.reasons.length).toBeGreaterThanOrEqual(5);
  });
});
