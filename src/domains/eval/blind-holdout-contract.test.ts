import { describe, expect, it } from "vitest";
import { validateBlindHoldout, type BlindHoldoutCaseReceipt } from "./blind-holdout-contract";

const archetypes = ["edit", "new_page", "zero_click_trap", "declining_page", "do_nothing"] as const;

function cases(): BlindHoldoutCaseReceipt[] {
  return archetypes.map((archetype, index) => ({
    id: `unseen-${index + 1}`,
    archetype,
    preregisteredAt: "2026-07-11T18:00:00.000Z",
    predictionRecordedAt: "2026-07-11T18:05:00.000Z",
    expertLabelRevealedAt: "2026-07-11T18:10:00.000Z",
    passed: true,
    codeChangedInResponse: false,
  }));
}

describe("validateBlindHoldout", () => {
  it("accepts only a diverse five-case run with frozen predictions before label reveal", () => {
    const out = validateBlindHoldout({ candidateSha: "a".repeat(40), cases: cases() });
    expect(out).toEqual({ releaseEligible: true, countedCases: 5, spentCases: 0, reasons: [] });
  });

  it("permanently spends a case that influenced code and requires a replacement", () => {
    const input = cases();
    input[2] = { ...input[2], codeChangedInResponse: true };
    const out = validateBlindHoldout({ candidateSha: "b".repeat(40), cases: input });
    expect(out.releaseEligible).toBe(false);
    expect(out.countedCases).toBe(4);
    expect(out.spentCases).toBe(1);
    expect(out.reasons.join(" ")).toContain("spent and cannot certify");
  });

  it("rejects label leakage, duplicate IDs, missing archetypes, and invalid SHAs", () => {
    const input = cases();
    input[0] = { ...input[0], predictionRecordedAt: "2026-07-11T18:15:00.000Z", passed: false };
    input[1] = { ...input[1], id: input[0].id };
    const out = validateBlindHoldout({ candidateSha: "not-a-sha", cases: input });
    expect(out.releaseEligible).toBe(false);
    expect(out.reasons.join(" ")).toContain("candidate commit");
    expect(out.reasons.join(" ")).toContain("preregistration");
    expect(out.reasons.join(" ")).toContain("unique");
    expect(out.reasons.join(" ")).toContain("missing the edit archetype");
  });

  it("rejects an honestly recorded failed expert judgment", () => {
    const input = cases();
    input[4] = { ...input[4], passed: false };
    const out = validateBlindHoldout({ candidateSha: "c".repeat(40), cases: input });
    expect(out.releaseEligible).toBe(false);
    expect(out.reasons).toContain("unseen-5 failed its expert judgment.");
  });
});
