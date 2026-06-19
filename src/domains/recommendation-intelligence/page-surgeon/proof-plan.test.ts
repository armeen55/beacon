import { describe, it, expect } from "vitest";

import { buildProofWindows, buildProofPlanRow } from "./proof-plan";

describe("proof-plan", () => {
  it("computes 7 / 14 / 28-day check-in windows from the decision date", () => {
    const w = buildProofWindows("2026-06-01T00:00:00.000Z");
    expect(w.checkIn7).toBe("2026-06-08");
    expect(w.checkIn14).toBe("2026-06-15");
    expect(w.checkIn28).toBe("2026-06-29");
  });

  it("builds a row with GSC baselines + windows + controls", () => {
    const row = buildProofPlanRow({
      pageUrl: "https://x.com/p",
      verdict: "approve",
      headlineAction: "intro_answer_block",
      decidedAt: "2026-06-01T00:00:00.000Z",
      measurementPlan: "Re-check per-query CTR in 28 days.",
      note: null,
      gsc: { clicks: 100, impressions: 5000, ctr: 0.02, avgPosition: 7, topQuery: "persian swear words" },
      controlPaths: ["/cities", "/farsi-numbers"],
    });
    expect(row.windows.checkIn28).toBe("2026-06-29");
    expect(row.metricsToCheck.some((m) => m.label.includes("persian swear words") && m.baseline === "2.00%")).toBe(true);
    expect(row.metricsToCheck.some((m) => m.baseline === "5,000")).toBe(true);
    expect(row.controlPaths).toEqual(["/cities", "/farsi-numbers"]);
  });

  it("yields no metrics when GSC is absent (no fabricated baseline)", () => {
    const row = buildProofPlanRow({
      pageUrl: "https://x.com/p", verdict: "needs_edit", headlineAction: "—",
      decidedAt: "2026-06-01T00:00:00.000Z", measurementPlan: null, note: "fix the wording",
      gsc: null, controlPaths: [],
    });
    expect(row.metricsToCheck).toHaveLength(0);
    expect(row.note).toBe("fix the wording");
  });
});
