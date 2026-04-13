import { describe, it, expect } from "vitest";
import { buildPrimaryDecisionCopy } from "@/lib/today-primary-decision-copy";

describe("buildPrimaryDecisionCopy", () => {
  it("maps schema-style strengthen_structure into four operator blocks", () => {
    const c = buildPrimaryDecisionCopy({
      rationale:
        "This page has 946 citations but is missing FAQPage + Service schema. Strengthening structure protects existing visibility and improves AI extractability.",
      expectedOutcome:
        "Adding missing structure to a page with 946 existing citations. Protects current visibility and improves how AI platforms extract and cite this content.",
      bucket: "high_leverage",
      confidence: "high",
      confidenceReason: "validated source change · 946 existing citations",
      type: "strengthen_structure",
    });
    expect(c.whyItMatters).toContain("946");
    expect(c.ifYouIgnore).toMatch(/structure|mentions/i);
    expect(c.successLooksLike).toContain("946");
    expect(c.leverageAndConfidence).toMatch(/high leverage/i);
    expect(c.leverageAndConfidence).toMatch(/relatively sure/i);
  });

  it("uses investigate-specific ignore line", () => {
    const c = buildPrimaryDecisionCopy({
      rationale: "Visibility declined in the same window as this change.",
      expectedOutcome: "Identify the root cause of visibility decline for affected topics.",
      bucket: "critical",
      confidence: "medium",
      confidenceReason: "partial source evidence",
      type: "investigate",
    });
    expect(c.ifYouIgnore).toMatch(/fuzzy|next import/i);
  });
});
