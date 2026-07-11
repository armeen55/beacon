import { describe, it, expect } from "vitest";
import { outranksReason, outranksReasonsBySequence } from "./strategy";
import type { CanonicalChange } from "./canonical-change";

/**
 * strategy - outranksReason (P1-3, 2026-07-10 visual audit). The audit found the "Ranked
 * above the next idea because it has more expected impact" line rendering as a near-identical
 * sentence on ~24 cards, since the balanced score favors higher impact almost by definition and
 * the old fallback stated that delta with no real number behind it. The fix: an impact-only
 * differentiator is dropped entirely unless it can be QUANTIFIED with a real forecast number
 * (the same monthly-clicks upside the card itself shows); evidence-tier and effort
 * differentiators (already specific) are unchanged.
 */
function ch(over: Partial<CanonicalChange> & { id: string }): CanonicalChange {
  return {
    tenantId: "t", pagePath: "/p", pageUrl: "https://s.com/p", pageLabel: "Page", opportunityType: "Capture clicks",
    changeType: "edit_meta", changeFamily: "meta", status: "suggested", recommendation: "Update the meta",
    exactInstructions: null, before: null, after: null, rationale: "why", estimatedEffortMinutes: 5,
    impactScore: 100, upside: null, expectedOutcome: null, riskLevel: "low", evidenceStrength: "directional",
    measurementMethod: "Diff-in-diff", selectedForToday: false, activeExperiment: false, protectedControl: false,
    blockedReason: null, result: null, measurementHeadline: null, measurementDetail: null, nextCheckpoint: null,
    attributionLimited: false, sourceIds: ["m1"], alternateOpportunities: [],
    ...over,
  };
}

describe("outranksReason - generic impact-only deltas are dropped, not stated vaguely", () => {
  it("returns null when the only difference is impactScore with no forecast (upside) numbers to quote", () => {
    const a = ch({ id: "a", impactScore: 200, upside: null });
    const b = ch({ id: "b", impactScore: 100, upside: null });
    expect(outranksReason(a, b)).toBeNull();
  });

  it("returns null when both carry an upside but they are equal (nothing to quantify)", () => {
    const a = ch({ id: "a", impactScore: 200, upside: 50 });
    const b = ch({ id: "b", impactScore: 100, upside: 50 });
    expect(outranksReason(a, b)).toBeNull();
  });

  it("quantifies the impact differentiator with real forecast numbers when both carry an upside", () => {
    const a = ch({ id: "a", impactScore: 200, upside: 240 });
    const b = ch({ id: "b", impactScore: 100, upside: 60 });
    expect(outranksReason(a, b)).toBe(
      "Ranked above the next idea because it is forecast to add more clicks (about 240 vs 60 a month).",
    );
  });

  it("never renders the old generic phrase", () => {
    const a = ch({ id: "a", impactScore: 500, upside: null });
    const b = ch({ id: "b", impactScore: 1, upside: null });
    const reason = outranksReason(a, b);
    expect(reason == null || !reason.includes("it has more expected impact")).toBe(true);
  });
});

describe("outranksReason - specific differentiators (evidence tier, effort) are unchanged", () => {
  it("names a stronger evidence tier", () => {
    const a = ch({ id: "a", evidenceStrength: "strong" });
    const b = ch({ id: "b", evidenceStrength: "tracking" });
    expect(outranksReason(a, b)).toBe(
      "Ranked above the next idea because its evidence is stronger (strong vs tracking only).",
    );
  });

  it("names a lower effort", () => {
    const a = ch({ id: "a", estimatedEffortMinutes: 2 });
    const b = ch({ id: "b", estimatedEffortMinutes: 20 });
    expect(outranksReason(a, b)).toBe(
      "Ranked above the next idea because it takes less time (2 vs 20 minutes).",
    );
  });

  it("is deterministic: identical inputs always produce the identical sentence", () => {
    const a = ch({ id: "a", evidenceStrength: "strong", upside: 300 });
    const b = ch({ id: "b", evidenceStrength: "tracking", upside: 50 });
    expect(outranksReason(a, b)).toBe(outranksReason(a, b));
  });
});

describe("outranksReasonsBySequence", () => {
  it("maps the last item in the sequence to null (nothing after it to out-rank)", () => {
    const a = ch({ id: "a", evidenceStrength: "strong" });
    const b = ch({ id: "b", evidenceStrength: "tracking" });
    const map = outranksReasonsBySequence([a, b]);
    expect(map.get("b")).toBeNull();
    expect(map.get("a")).not.toBeNull();
  });
});
