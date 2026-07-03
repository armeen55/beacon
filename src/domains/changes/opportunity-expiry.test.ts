import { describe, expect, it } from "vitest";
import {
  classifyOpportunityFreshness,
  summarizeExpiry,
  AGING_THRESHOLD_DAYS,
  EXPIRED_THRESHOLD_DAYS,
  type EvidenceDate,
} from "./opportunity-expiry";
import { hasBannedDash } from "@/lib/copy/strip-dashes";

const NOW = new Date("2026-07-03T00:00:00Z");
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe("classifyOpportunityFreshness - boundaries", () => {
  it("no evidence dates at all classifies fresh with null daysSinceFreshest (honest default, never guessed)", () => {
    const result = classifyOpportunityFreshness([], NOW);
    expect(result.verdict).toBe("fresh");
    expect(result.daysSinceFreshest).toBeNull();
    expect(result.agingChip).toBeNull();
    expect(result.expiredReason).toBeNull();
  });

  it("evidence from today is fresh", () => {
    const dates: EvidenceDate[] = [{ kind: "serp_verdict", date: daysAgo(0) }];
    expect(classifyOpportunityFreshness(dates, NOW).verdict).toBe("fresh");
  });

  it("evidence one day short of the aging threshold is still fresh", () => {
    const dates: EvidenceDate[] = [{ kind: "gsc_window", date: daysAgo(AGING_THRESHOLD_DAYS - 1) }];
    expect(classifyOpportunityFreshness(dates, NOW).verdict).toBe("fresh");
  });

  it("evidence exactly at the aging threshold (21d) is aging", () => {
    const dates: EvidenceDate[] = [{ kind: "gsc_window", date: daysAgo(AGING_THRESHOLD_DAYS) }];
    const result = classifyOpportunityFreshness(dates, NOW);
    expect(result.verdict).toBe("aging");
    expect(result.agingChip).toBe("evidence from 3 weeks ago");
    expect(result.expiredReason).toBeNull();
  });

  it("evidence one day short of the expired threshold is still aging", () => {
    const dates: EvidenceDate[] = [{ kind: "keyword_research", date: daysAgo(EXPIRED_THRESHOLD_DAYS - 1) }];
    expect(classifyOpportunityFreshness(dates, NOW).verdict).toBe("aging");
  });

  it("evidence exactly at the expired threshold (45d) is expired", () => {
    const dates: EvidenceDate[] = [{ kind: "keyword_research", date: daysAgo(EXPIRED_THRESHOLD_DAYS) }];
    const result = classifyOpportunityFreshness(dates, NOW);
    expect(result.verdict).toBe("expired");
    expect(result.expiredReason).toBe("my evidence for this is 6 weeks old");
    expect(result.agingChip).toBeNull();
  });

  it("very old evidence is expired", () => {
    const dates: EvidenceDate[] = [{ kind: "competitor_teardown", date: daysAgo(120) }];
    expect(classifyOpportunityFreshness(dates, NOW).verdict).toBe("expired");
  });

  it("the row is only as stale as its BEST (freshest) evidence, not its worst", () => {
    const dates: EvidenceDate[] = [
      { kind: "competitor_teardown", date: daysAgo(90) }, // old
      { kind: "serp_verdict", date: daysAgo(2) }, // fresh
    ];
    const result = classifyOpportunityFreshness(dates, NOW);
    expect(result.verdict).toBe("fresh");
    expect(result.daysSinceFreshest).toBe(2);
  });

  it("an invalid date string is ignored, not crashed on", () => {
    const dates: EvidenceDate[] = [{ kind: "serp_verdict", date: "not-a-date" }];
    const result = classifyOpportunityFreshness(dates, NOW);
    expect(result.verdict).toBe("fresh");
    expect(result.daysSinceFreshest).toBeNull();
  });

  it("no dash anywhere in a generated sentence (hard rule)", () => {
    const aging = classifyOpportunityFreshness([{ kind: "gsc_window", date: daysAgo(25) }], NOW);
    const expired = classifyOpportunityFreshness([{ kind: "gsc_window", date: daysAgo(60) }], NOW);
    expect(hasBannedDash(aging.agingChip ?? "")).toBe(false);
    expect(hasBannedDash(expired.expiredReason ?? "")).toBe(false);
  });
});

describe("classifyOpportunityFreshness - seasonal window passed", () => {
  it("a seasonal window that already passed expires the row even with a fresh computation date", () => {
    const dates: EvidenceDate[] = [
      { kind: "seasonal_window", date: daysAgo(1), windowPassedAt: daysAgo(5) }, // computed yesterday, window passed 5 days ago
    ];
    const result = classifyOpportunityFreshness(dates, NOW);
    expect(result.verdict).toBe("expired");
    expect(result.expiredReason).toBe("the seasonal window this was timed for has already passed");
  });

  it("a seasonal window that has NOT yet passed does not expire the row on that basis alone", () => {
    const future = new Date(NOW.getTime() + 10 * 86_400_000).toISOString();
    const dates: EvidenceDate[] = [{ kind: "seasonal_window", date: daysAgo(1), windowPassedAt: future }];
    const result = classifyOpportunityFreshness(dates, NOW);
    expect(result.verdict).toBe("fresh");
  });

  it("a seasonal window passing exactly now counts as passed (inclusive boundary)", () => {
    const dates: EvidenceDate[] = [{ kind: "seasonal_window", date: daysAgo(1), windowPassedAt: NOW.toISOString() }];
    expect(classifyOpportunityFreshness(dates, NOW).verdict).toBe("expired");
  });

  it("seasonal-passed takes priority over an otherwise-fresh age reading", () => {
    const dates: EvidenceDate[] = [
      { kind: "seasonal_window", date: daysAgo(0), windowPassedAt: daysAgo(1) }, // computed today, but window already passed
      { kind: "serp_verdict", date: daysAgo(0) }, // also fresh
    ];
    expect(classifyOpportunityFreshness(dates, NOW).verdict).toBe("expired");
  });

  it("a seasonal_window entry with no windowPassedAt is judged on age like any other date", () => {
    const dates: EvidenceDate[] = [{ kind: "seasonal_window", date: daysAgo(5) }];
    expect(classifyOpportunityFreshness(dates, NOW).verdict).toBe("fresh");
  });
});

describe("summarizeExpiry - the honest expander sub-line", () => {
  it("returns a null subline when nothing expired (byte-identical to before N46 existed)", () => {
    const summary = summarizeExpiry(["fresh", "fresh", "aging"]);
    expect(summary.expiredSubline).toBeNull();
    expect(summary.expiredCount).toBe(0);
    expect(summary.agingCount).toBe(1);
  });

  it("names the exact expired count and the honest re-check promise, singular vs plural is not needed (always plural M)", () => {
    const summary = summarizeExpiry(["expired", "expired", "fresh", "aging"]);
    expect(summary.expiredCount).toBe(2);
    expect(summary.expiredSubline).toBe("2 of these aged out; I will re-check their evidence before pitching them again.");
    expect(hasBannedDash(summary.expiredSubline!)).toBe(false);
  });

  it("counts every row, including zero total (empty list)", () => {
    const summary = summarizeExpiry([]);
    expect(summary.rows).toBe(0);
    expect(summary.expiredSubline).toBeNull();
  });
});
