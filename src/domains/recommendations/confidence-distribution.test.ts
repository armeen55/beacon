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

import { describe, expect, it } from "vitest";
import {
  computeRecConfidence,
  type ComputeRecConfidenceArgs,
} from "./confidence";

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
