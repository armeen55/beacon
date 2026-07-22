/** Confidence scoring + distribution + calibrated abstention (Core 100K Phase 6 merge). */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { computeRecConfidence, HIGH_MIN_AFFECTED_PROMPTS, HIGH_MIN_EVIDENCE_REFS, type ComputeRecConfidenceArgs, type ConfidenceEditInput } from "@/domains/recommendations/confidence";
import { assessAbstention, hasSufficientEvidence, partitionByEvidence, heldForEvidenceLine, WATCHING_SENTENCE, type AbstentionEvidence } from "@/domains/recommendations/abstention";

// ===== from src/domains/recommendations/confidence.test.ts =====
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

  // W3 Step 3.5b.B (2026-05-02) — operator-revised: deterministic-only
  // tier BLOCKS Strong but does NOT force Weak signal when other
  // dimensions are reasonable. The operator's browser audit flagged
  // "every card says Weak signal" as a trust-killer. Deterministic-
  // only is a HIGH blocker, MEDIUM verdict.
  it("MEDIUM (not LOW): tier === 'deterministic_only' with otherwise reasonable evidence", () => {
    const verdict = computeRecConfidence(
      highArgs({ resolverTier: "deterministic_only" }),
    );
    expect(verdict.confidence).toBe("medium");
    expect(verdict.reasons).toContain("tier_not_adjudicated_or_inventory");
    expect(verdict.reasons).not.toContain("tier_deterministic_only");
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
    expect(verdict.reasons).toContain("tier_not_adjudicated_or_inventory");
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

// ── W3 Step 3.5b.B — Weak signal isn't the default ──────────────────────

describe("W3 Step 3.5b.B — confidence semantics revision", () => {
  /**
   * Operator's browser audit (2026-05-02) flagged: "every card shows
   * Weak signal — the product looks like it does not trust itself."
   * Root cause: `tier_deterministic_only` was a hard LOW gate, so any
   * rec without a real resolver tier landed in Weak signal even when
   * it had real evidence. This describe block locks the new
   * semantics:
   *   - deterministic-only with real evidence → MEDIUM (Review)
   *   - genuinely thin (single prompt + no evidence + no refs) → LOW
   */

  it("LOW: single prompt + no packet signal + zero evidence refs (truly thin)", () => {
    const verdict = computeRecConfidence(
      highArgs({
        affectedPromptCount: 1,
        evidenceRefCount: 0,
        hasAiSearchSignal: false,
        hasCompetitorPageBlueprints: false,
      }),
    );
    expect(verdict.confidence).toBe("low");
    expect(verdict.reasons).toEqual(["single_prompt_no_evidence"]);
  });

  it("MEDIUM (not LOW): single prompt with packet signal — has real grounding", () => {
    const verdict = computeRecConfidence(
      highArgs({
        affectedPromptCount: 1,
        evidenceRefCount: 0,
        hasAiSearchSignal: true,
      }),
    );
    expect(verdict.confidence).toBe("medium");
  });

  it("MEDIUM (not LOW): single prompt with evidence refs — has structured grounding", () => {
    const verdict = computeRecConfidence(
      highArgs({
        affectedPromptCount: 1,
        evidenceRefCount: 2,
        hasAiSearchSignal: false,
        hasCompetitorPageBlueprints: false,
      }),
    );
    expect(verdict.confidence).toBe("medium");
  });

  it("MEDIUM (not LOW): deterministic-only tier with multi-prompt + evidence", () => {
    const verdict = computeRecConfidence(
      highArgs({
        resolverTier: "deterministic_only",
        affectedPromptCount: 3,
        evidenceRefCount: 4,
      }),
    );
    expect(verdict.confidence).toBe("medium");
    expect(verdict.reasons).toContain("tier_not_adjudicated_or_inventory");
  });

  it("MEDIUM is the catch-all — most well-formed but non-Strong recs land here", () => {
    // Realistic Ritz queue shape: deterministic-only resolver +
    // multi-prompt + decent evidence + no LLM packet signal yet.
    // Under pre-Step-3.5b semantics this would have been LOW
    // (deterministic_only forced LOW). Now it should be MEDIUM.
    const verdict = computeRecConfidence({
      affectedPromptCount: 3,
      resolverTier: "deterministic_only",
      resolutionConfidence: "medium",
      needsHumanReview: false,
      evidenceRefCount: 3,
      edits: [
        {
          proposed_text:
            "Comprehensive section explaining design-build approach with ten years of project examples in the Bay Area.",
          confidence: "medium",
          target_element_key: "h2[new]:abc",
        },
      ],
      hasAiSearchSignal: false,
      hasCompetitorPageBlueprints: false,
      competitorNames: [],
    });
    expect(verdict.confidence).toBe("medium");
  });

  it("INVARIANT: a queue of well-formed recs does not become all LOW", () => {
    // Simulates 5 different rec shapes typical of the post-Step-3.4
    // Ritz queue. Most should land in MEDIUM. ZERO should land in
    // LOW just because deterministic-only fired. The operator
    // requirement (post-3.5b) is: "Most of the current queue should
    // probably be Review, not Weak signal."
    const queue = [
      // a) deterministic-only multi-prompt rec
      highArgs({
        resolverTier: "deterministic_only",
        resolutionConfidence: "medium",
        affectedPromptCount: 3,
      }),
      // b) inventory tier with real grounding
      highArgs({
        resolverTier: "inventory",
        resolutionConfidence: "medium",
      }),
      // c) observation tier multi-prompt
      highArgs({
        resolverTier: "observation",
        resolutionConfidence: "medium",
        affectedPromptCount: 4,
      }),
      // d) deterministic-only single prompt but with packet signal
      highArgs({
        resolverTier: "deterministic_only",
        resolutionConfidence: "medium",
        affectedPromptCount: 1,
        hasAiSearchSignal: true,
      }),
      // e) HIGH-eligible rec (all 6 dimensions pass)
      highArgs(),
    ];

    const verdicts = queue.map((args) => computeRecConfidence(args));
    const lowCount = verdicts.filter((v) => v.confidence === "low").length;
    expect(lowCount).toBe(0);
  });
});

// ===== from src/domains/recommendations/confidence-distribution.test.ts =====
/**
 * W3 Step 3.5d (2026-05-02) — confidence distribution sanity check.
 *
 * Operator scope (browser audit, third pass):
 *   "Default cards must NOT all read Weak signal. The page should
 *    look like Beacon trusts itself when the evidence is real."
 *
 * The Step 3.5b.B fix removed `tier_deterministic_only` from the LOW
 * gate set so that deterministic-only recs with otherwise reasonable
 * evidence land in MEDIUM, not LOW. This test pins that fix against a
 * Ritz-shaped fixture queue:
 *
 *   - 2 multi-prompt adjudicated recs with grounded packet evidence
 *     and high-confidence edits (HIGH)
 *   - 4 deterministic-only recs with medium-confidence edits + 2
 *     evidence refs (MEDIUM, not LOW)
 *   - 1 single-prompt cluster with no edits (LOW — genuinely thin)
 *   - 1 needsHumanReview rec (LOW — operator-flagged)
 *
 * Expected distribution:
 *   HIGH ≥ 1, MEDIUM strictly > LOW, LOW ≤ 25% of queue.
 *
 * The contract this test pins is "the rendered queue is not majority
 * Weak signal." Without this guard, the Step 3.5 confidence pill
 * would flash red across every card and nobody would trust it.
 */


type Rec = ComputeRecConfidenceArgs;

/** A 2-prompt, adjudicated, grounded rec — the HIGH happy path. */
function highRec(): Rec {
  return {
    affectedPromptCount: 3,
    resolverTier: "adjudicated",
    resolutionConfidence: "high",
    needsHumanReview: false,
    evidenceRefCount: 3,
    edits: [
      {
        proposed_text: "Add a section on Atherton older-home rebuilds.",
        confidence: "high",
      },
      {
        proposed_text: "Reframe the H1 to emphasize structural remodel work.",
        confidence: "high",
      },
    ],
    hasAiSearchSignal: true,
    hasCompetitorPageBlueprints: true,
    competitorNames: ["De Mattei", "Greenberg"],
  };
}

/** A deterministic-only rec with reasonable signal — should be MEDIUM. */
function mediumDeterministicRec(): Rec {
  return {
    affectedPromptCount: 2,
    resolverTier: "deterministic_only",
    resolutionConfidence: "medium",
    needsHumanReview: false,
    evidenceRefCount: 2,
    edits: [
      {
        proposed_text: "Add a kitchen remodel cost section to the homepage.",
        confidence: "medium",
      },
    ],
    hasAiSearchSignal: true,
    hasCompetitorPageBlueprints: false,
    competitorNames: ["De Mattei"],
  };
}

/** Single-prompt with no edits — genuinely LOW. */
function lowSingletonRec(): Rec {
  return {
    affectedPromptCount: 1,
    resolverTier: "observation",
    resolutionConfidence: "low",
    needsHumanReview: false,
    evidenceRefCount: 0,
    edits: [],
    hasAiSearchSignal: false,
    hasCompetitorPageBlueprints: false,
  };
}

/** Operator-flagged review — LOW. */
function lowReviewRec(): Rec {
  return {
    affectedPromptCount: 4,
    resolverTier: "adjudicated",
    resolutionConfidence: "high",
    needsHumanReview: true, // gate fires
    evidenceRefCount: 4,
    edits: [
      { proposed_text: "Some good copy.", confidence: "high" },
    ],
    hasAiSearchSignal: true,
    hasCompetitorPageBlueprints: true,
  };
}

describe("W3 Step 3.5d — confidence distribution on a Ritz-shaped queue", () => {
  it("rendered queue is NOT majority Weak signal (LOW)", () => {
    const recs: Rec[] = [
      // 2 HIGH
      highRec(),
      highRec(),
      // 4 MEDIUM (deterministic-only with real signal)
      mediumDeterministicRec(),
      mediumDeterministicRec(),
      mediumDeterministicRec(),
      mediumDeterministicRec(),
      // 2 LOW (genuinely thin / needs review)
      lowSingletonRec(),
      lowReviewRec(),
    ];

    const verdicts = recs.map((r) => computeRecConfidence(r));
    const countByLevel = verdicts.reduce<{
      high: number;
      medium: number;
      low: number;
    }>(
      (acc, v) => {
        acc[v.confidence] += 1;
        return acc;
      },
      { high: 0, medium: 0, low: 0 },
    );

    // Operator-locked thresholds:
    //   - At least one HIGH (the rubric is reachable, not all-MEDIUM).
    //   - MEDIUM strictly outnumbers LOW (page doesn't look hostile).
    //   - LOW ≤ 25% of queue (every-card-Weak regression guard).
    expect(countByLevel.high).toBeGreaterThanOrEqual(1);
    expect(countByLevel.medium).toBeGreaterThan(countByLevel.low);
    expect(countByLevel.low / recs.length).toBeLessThanOrEqual(0.25);
  });

  it("deterministic-only with real evidence lands MEDIUM, not LOW", () => {
    // Operator scope: this is the Step 3.5b.B fix. Pin it.
    const verdict = computeRecConfidence(mediumDeterministicRec());
    expect(verdict.confidence).toBe("medium");
    expect(verdict.confidence).not.toBe("low");
  });

  it("multi-prompt adjudicated with grounded signal lands HIGH", () => {
    const verdict = computeRecConfidence(highRec());
    expect(verdict.confidence).toBe("high");
  });

  it("single-prompt + no edits + low resolution → LOW (genuinely thin)", () => {
    const verdict = computeRecConfidence(lowSingletonRec());
    expect(verdict.confidence).toBe("low");
  });

  it("needs_human_review forces LOW even when other dimensions look strong", () => {
    const verdict = computeRecConfidence(lowReviewRec());
    expect(verdict.confidence).toBe("low");
    expect(verdict.reasons).toContain("needs_human_review");
  });
});

// ===== from src/domains/recommendations/abstention.test.ts =====
/**
 * Tests for abstention (BEACON_500 N49) - calibrated abstention / law 2.
 *
 * Coverage:
 *  - sufficiency rule: any one of the three signals => ready; none => watching
 *  - the honest hold sentence + "ready" sentence naming what backs the move
 *  - byte-identical-when-all-evidenced (partitionByEvidence held is empty)
 *  - held-for-evidence count line (singular/plural/zero)
 */


const NONE: AbstentionEvidence = {
  hasDemandSignal: false,
  hasCompetitorTeardown: false,
  hasBehaviorOrGscSignal: false,
};

describe("assessAbstention - sufficiency rule", () => {
  it("holds when NONE of the three signals is present (pure proxy guess)", () => {
    const v = assessAbstention(NONE);
    expect(v.state).toBe("watching");
    expect(v.presentSignals).toEqual([]);
    expect(v.sentence).toBe(WATCHING_SENTENCE);
  });

  it("is ready with demand alone", () => {
    const v = assessAbstention({ ...NONE, hasDemandSignal: true });
    expect(v.state).toBe("ready");
    expect(v.presentSignals).toEqual(["demand"]);
    expect(v.sentence).toContain("real search demand");
  });

  it("is ready with a competitor teardown alone", () => {
    const v = assessAbstention({ ...NONE, hasCompetitorTeardown: true });
    expect(v.state).toBe("ready");
    expect(v.presentSignals).toEqual(["competitor"]);
    expect(v.sentence).toContain("a competitor already covering this");
  });

  it("is ready with a first-party behavior/GSC signal alone", () => {
    const v = assessAbstention({ ...NONE, hasBehaviorOrGscSignal: true });
    expect(v.state).toBe("ready");
    expect(v.presentSignals).toEqual(["behavior_or_gsc"]);
    expect(v.sentence).toContain("this page's own search numbers moving");
  });

  it("names all present signals when several corroborate", () => {
    const v = assessAbstention({
      hasDemandSignal: true,
      hasCompetitorTeardown: true,
      hasBehaviorOrGscSignal: true,
    });
    expect(v.state).toBe("ready");
    expect(v.presentSignals).toEqual(["demand", "competitor", "behavior_or_gsc"]);
    expect(v.sentence).toContain("real search demand");
    expect(v.sentence).toContain("a competitor already covering this");
    expect(v.sentence).toContain("this page's own search numbers moving");
  });

  it("no sentence carries a banned dash or a lab word", () => {
    for (const v of [
      assessAbstention(NONE),
      assessAbstention({ ...NONE, hasDemandSignal: true }),
    ]) {
      expect(v.sentence).not.toMatch(/[—–]/);
      expect(v.sentence.toLowerCase()).not.toMatch(/\b(experiment|control|baseline|treatment|serp)\b/);
    }
  });
});

describe("hasSufficientEvidence - the boolean predicate", () => {
  it("false only when nothing is present", () => {
    expect(hasSufficientEvidence(NONE)).toBe(false);
    expect(hasSufficientEvidence({ ...NONE, hasDemandSignal: true })).toBe(true);
    expect(hasSufficientEvidence({ ...NONE, hasCompetitorTeardown: true })).toBe(true);
    expect(hasSufficientEvidence({ ...NONE, hasBehaviorOrGscSignal: true })).toBe(true);
  });
});

describe("partitionByEvidence - the final-filter seam", () => {
  type Item = { id: string; ev: AbstentionEvidence };
  const extract = (i: Item) => i.ev;

  it("BYTE-IDENTICAL when every item is evidenced: held is empty, ready is the input in order", () => {
    const items: Item[] = [
      { id: "a", ev: { ...NONE, hasDemandSignal: true } },
      { id: "b", ev: { ...NONE, hasCompetitorTeardown: true } },
      { id: "c", ev: { ...NONE, hasBehaviorOrGscSignal: true } },
    ];
    const { ready, held } = partitionByEvidence(items, extract);
    expect(held).toEqual([]);
    expect(ready.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("holds only the un-evidenced items, each with its watching verdict", () => {
    const items: Item[] = [
      { id: "a", ev: { ...NONE, hasDemandSignal: true } },
      { id: "b", ev: NONE },
      { id: "c", ev: NONE },
    ];
    const { ready, held } = partitionByEvidence(items, extract);
    expect(ready.map((r) => r.id)).toEqual(["a"]);
    expect(held.map((h) => h.item.id)).toEqual(["b", "c"]);
    expect(held.every((h) => h.verdict.state === "watching")).toBe(true);
    expect(held.every((h) => h.verdict.sentence === WATCHING_SENTENCE)).toBe(true);
  });

  it("an empty batch yields empty ready and held", () => {
    const { ready, held } = partitionByEvidence<Item>([], extract);
    expect(ready).toEqual([]);
    expect(held).toEqual([]);
  });
});

describe("heldForEvidenceLine - the honest count surface", () => {
  it("is null when nothing is held (absence says everything is backed)", () => {
    expect(heldForEvidenceLine(0)).toBeNull();
    expect(heldForEvidenceLine(-1)).toBeNull();
  });

  it("is singular for one", () => {
    expect(heldForEvidenceLine(1)).toBe(
      "1 possible move is waiting for more evidence before I recommend it.",
    );
  });

  it("is plural for many, with the count", () => {
    expect(heldForEvidenceLine(6)).toBe(
      "6 possible moves are waiting for more evidence before I recommend them.",
    );
  });

  it("no line carries a banned dash", () => {
    expect(heldForEvidenceLine(6)).not.toMatch(/[—–]/);
  });
});
