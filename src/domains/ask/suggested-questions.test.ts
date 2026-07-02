import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: vi.fn(async () => "tenant-test"),
}));
vi.mock("@/domains/recommendation-intelligence/gsc-page-queries", () => ({
  loadDailyTotalsForTenant: vi.fn(async () => []),
}));
vi.mock("@/domains/answer-intelligence/store", () => ({
  getAnswerIntelligenceIndex: vi.fn(async () => null),
}));

import { loadSuggestedQuestions } from "./suggested-questions";
import { loadDailyTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { getAnswerIntelligenceIndex } from "@/domains/answer-intelligence/store";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ask/suggested-questions", () => {
  it("always returns exactly 3 questions even with zero live data", async () => {
    const qs = await loadSuggestedQuestions();
    expect(qs).toHaveLength(3);
    expect(qs.every((q) => typeof q === "string" && q.length > 0)).toBe(true);
  });

  it("surfaces a real changepoint date when one exists", async () => {
    // Mirrors changepoint.test.ts's own step-shift fixture shape: the CUSUM detector
    // needs several weeks of trailing same-weekday history before it trusts a baseline,
    // so a short synthetic series never fires (matches the detector's own fail-closed
    // "not enough history" contract, not a bug in this module).
    const DAY_MS = 86_400_000;
    const start = Date.parse("2026-01-01T00:00:00Z"); // a Thursday
    const iso = (i: number) => new Date(start + i * DAY_MS).toISOString().slice(0, 10);
    const days = [
      ...Array.from({ length: 35 }, (_, i) => ({ date: iso(i), clicks: 200, impressions: 2000 })),
      ...Array.from({ length: 21 }, (_, i) => ({ date: iso(35 + i), clicks: 130, impressions: 2000 })),
    ];
    vi.mocked(loadDailyTotalsForTenant).mockResolvedValueOnce(days);
    const qs = await loadSuggestedQuestions();
    expect(qs.some((q) => q.startsWith("why did clicks drop"))).toBe(true);
  });

  it("surfaces the answer-box question when a displacing competitor exists", async () => {
    vi.mocked(getAnswerIntelligenceIndex).mockResolvedValueOnce({
      co_citation: { competitors: [{ domain: "rival.com", when_owned_present: 1, when_owned_absent: 9, total_answer_appearances: 10, displacement_ratio: 0.9 }] },
    } as never);
    const qs = await loadSuggestedQuestions();
    expect(qs).toContain("who is beating me on Google's answer box");
  });

  it("never throws when both loaders reject", async () => {
    vi.mocked(loadDailyTotalsForTenant).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(getAnswerIntelligenceIndex).mockRejectedValueOnce(new Error("boom"));
    await expect(loadSuggestedQuestions()).resolves.toHaveLength(3);
  });
});
