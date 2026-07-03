/**
 * N48 expert-review pass (2026-07-03): the final deterministic read over a rec
 * that already cleared the confidence gate. It checks the rec reads like an
 * expert wrote it (a concrete number, a real next step, no generic filler, no
 * self-contradiction) and HOLDS it honestly on failure. Lower-only: it can
 * never raise confidence or rescue a reject, and a clean rec passes through
 * byte-identically so nothing new surfaces on a good recommendation.
 */

import { describe, expect, it } from "vitest";

import {
  reviewExpertQuality,
  type ExpertVerdict,
  type ExpertReviewInput,
} from "@/domains/recommendations/expert-verdict";

const cleanHigh: ExpertVerdict = {
  enforcedConfidence: "high",
  enforcedApprove: true,
  gateNotes: ["Strong evidence and intent fit (topic 82/100, intent 78/100)."],
};

function input(overrides: Partial<ExpertReviewInput> = {}): ExpertReviewInput {
  return {
    whyExists:
      "People saw your page 9,137 times for this query and you rank #3.",
    proposedText: "Best Persian Koobideh Kabob Recipe (Step by Step)",
    measurementPlan: "Track the click-through on this query for 14 days.",
    confidenceReason: "Strong evidence and intent fit (topic 82/100, intent 78/100).",
    hasQuotedEvidence: true,
    actionIsConcrete: true,
    ...overrides,
  };
}

describe("reviewExpertQuality N48 final expert read", () => {
  it("passes a clean, specific, actionable rec UNCHANGED (byte-identical)", () => {
    const out = reviewExpertQuality(cleanHigh, input());
    expect(out).toBe(cleanHigh);
  });

  it("holds a rec with no concrete number when it has no quoted evidence", () => {
    const out = reviewExpertQuality(cleanHigh, {
      ...input(),
      whyExists: "This page has demand worth acting on.",
      proposedText: null,
      measurementPlan: null,
      confidenceReason: "This page has demand worth acting on.",
      hasQuotedEvidence: false,
      actionIsConcrete: false,
    });
    expect(out.enforcedConfidence).toBe("needs_more_evidence");
    expect(out.enforcedApprove).toBe(false);
    expect(out.gateNotes[out.gateNotes.length - 1]).toContain(
      "concrete number",
    );
    expect(out.gateNotes[out.gateNotes.length - 1]).toContain(
      "read like an expert wrote it",
    );
  });

  it("a quoted evidence line satisfies the number check even with bare prose", () => {
    const out = reviewExpertQuality(cleanHigh, {
      ...input(),
      whyExists: "This page has a gap worth acting on.",
      proposedText: null,
      hasQuotedEvidence: true,
      actionIsConcrete: true,
    });
    expect(out).toBe(cleanHigh);
  });

  it("holds a rec that reads like generic filler", () => {
    const out = reviewExpertQuality(cleanHigh, {
      ...input(),
      whyExists:
        "Optimize your content and leverage synergies for 9,137 impressions.",
    });
    expect(out.enforcedConfidence).toBe("needs_more_evidence");
    expect(out.gateNotes[out.gateNotes.length - 1]).toContain(
      "generic filler",
    );
  });

  it("holds a rec that contradicts itself on how the page is doing", () => {
    const out = reviewExpertQuality(cleanHigh, {
      ...input(),
      whyExists:
        "This page ranks well at #2 for 9,137 searches but does not rank for it.",
    });
    expect(out.enforcedConfidence).toBe("needs_more_evidence");
    expect(out.gateNotes[out.gateNotes.length - 1]).toContain(
      "contradicts itself",
    );
  });

  it("never reviews a rec the gate already held (leaves it verbatim)", () => {
    const held: ExpertVerdict = {
      enforcedConfidence: "needs_more_evidence",
      enforcedApprove: false,
      gateNotes: ["No core evidence family is present."],
    };
    const out = reviewExpertQuality(held, {
      ...input(),
      whyExists: "leverage synergies",
      hasQuotedEvidence: false,
      actionIsConcrete: false,
    });
    expect(out).toBe(held);
  });

  it("never reviews a rejected rec", () => {
    const rejected: ExpertVerdict = {
      enforcedConfidence: "rejected",
      enforcedApprove: false,
      gateNotes: ["A deterministic safety gate rejected this recommendation."],
    };
    const out = reviewExpertQuality(rejected, input());
    expect(out).toBe(rejected);
  });

  it("holds a good rec that misses BOTH a number and a next step, listing both", () => {
    const out = reviewExpertQuality(cleanHigh, {
      whyExists: "This page has a gap.",
      proposedText: null,
      measurementPlan: null,
      confidenceReason: "This page has a gap.",
      hasQuotedEvidence: false,
      actionIsConcrete: false,
    });
    expect(out.enforcedConfidence).toBe("needs_more_evidence");
    const last = out.gateNotes[out.gateNotes.length - 1]!;
    expect(last).toContain("concrete number");
    expect(last).toContain("what to actually do next");
  });

  it("the hold note contains no em or en dash (Beacon voice)", () => {
    const out = reviewExpertQuality(cleanHigh, {
      ...input(),
      whyExists: "leverage synergies",
    });
    const last = out.gateNotes[out.gateNotes.length - 1]!;
    expect(/[‒–—―]/.test(last)).toBe(false);
  });
});
