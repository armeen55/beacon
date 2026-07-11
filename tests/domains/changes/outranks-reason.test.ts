/**
 * outranksReason (Wave 3C, 3D) - the comparative "why this ranks above the next idea" line.
 * Deterministic, attributes the largest positive score-component deltas, omits (null) when nothing
 * credibly explains ranking `a` above `b`, and is null for the last card in a sequence.
 */
import { describe, expect, it } from "vitest";
import { outranksReason, outranksReasonsBySequence } from "@/domains/changes/strategy";
import type { CanonicalChange } from "@/domains/changes/canonical-change";

function cc(over: Partial<CanonicalChange>): CanonicalChange {
  return {
    id: "x", tenantId: "t", pagePath: "/x", pageUrl: "https://s/x", pageLabel: "x",
    opportunityType: "Capture clicks", changeType: "edit_meta", changeFamily: "meta",
    status: "suggested", recommendation: "r", exactInstructions: null, before: null, after: null,
    rationale: "why", estimatedEffortMinutes: 5, impactScore: 100, upside: null, expectedOutcome: null,
    riskLevel: "low", evidenceStrength: "directional", measurementMethod: "m", selectedForToday: false,
    activeExperiment: false, protectedControl: false, blockedReason: null, result: null,
    measurementHeadline: null, measurementDetail: null, nextCheckpoint: null, attributionLimited: false,
    sourceIds: [], alternateOpportunities: [], ...over,
  } as CanonicalChange;
}

describe("outranksReason", () => {
  it("names stronger evidence, in plain words, when that is the biggest positive delta", () => {
    const a = cc({ id: "a", evidenceStrength: "strong", impactScore: 100, estimatedEffortMinutes: 5 });
    const b = cc({ id: "b", evidenceStrength: "directional", impactScore: 100, estimatedEffortMinutes: 5 });
    const line = outranksReason(a, b, "balanced");
    expect(line).toContain("Ranked above the next idea because");
    expect(line).toContain("its evidence is stronger (strong vs directional)");
  });

  it("names less time when the faster change also wins on effort", () => {
    const a = cc({ id: "a", evidenceStrength: "strong", estimatedEffortMinutes: 1 });
    const b = cc({ id: "b", evidenceStrength: "directional", estimatedEffortMinutes: 10 });
    const line = outranksReason(a, b, "balanced");
    expect(line).toContain("it takes less time (1 vs 10 minutes)");
  });

  it("is deterministic - the same inputs always produce the same sentence", () => {
    const a = cc({ id: "a", evidenceStrength: "strong", estimatedEffortMinutes: 2, riskLevel: "low" });
    const b = cc({ id: "b", evidenceStrength: "tracking", estimatedEffortMinutes: 30, riskLevel: "high" });
    expect(outranksReason(a, b, "balanced")).toBe(outranksReason(a, b, "balanced"));
  });

  it("returns null when nothing about a credibly explains ranking it above b", () => {
    const a = cc({ id: "a", evidenceStrength: "directional", impactScore: 50, estimatedEffortMinutes: 10, riskLevel: "medium" });
    const b = cc({ id: "b", evidenceStrength: "strong", impactScore: 100, estimatedEffortMinutes: 2, riskLevel: "low" });
    expect(outranksReason(a, b, "balanced")).toBeNull();
  });

  it("never emits an em or en dash", () => {
    const a = cc({ id: "a", evidenceStrength: "strong", estimatedEffortMinutes: 1 });
    const b = cc({ id: "b", evidenceStrength: "tracking", estimatedEffortMinutes: 60 });
    expect(outranksReason(a, b, "balanced")).not.toMatch(/[–—]/);
  });

  it("outranksReasonsBySequence maps the LAST card to null (nothing after it to out-rank)", () => {
    const seq = [
      cc({ id: "a", evidenceStrength: "strong", estimatedEffortMinutes: 1 }),
      cc({ id: "b", evidenceStrength: "directional", estimatedEffortMinutes: 5 }),
      cc({ id: "c", evidenceStrength: "tracking", estimatedEffortMinutes: 10 }),
    ];
    const map = outranksReasonsBySequence(seq, "balanced");
    expect(map.get("a")).not.toBeNull();
    expect(map.get("c")).toBeNull();
    expect(map.size).toBe(3);
  });
});
