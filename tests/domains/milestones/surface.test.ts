import { describe, it, expect } from "vitest";
import { pickTodayMilestoneTeaser, filterMarketMilestones } from "@/domains/milestones/surface";
import type { MilestoneEvent, MilestoneState } from "@/domains/milestones/types";

function makeEvent(
  id: string,
  overrides: Partial<MilestoneEvent> = {},
): MilestoneEvent {
  return {
    id,
    kind: "citation_daily_total",
    key: "citation_daily_total",
    title: `Event ${id}`,
    subtitle: "sub",
    achievedAt: new Date().toISOString(),
    value: 100,
    proofSummary: "test",
    magnitude: "minor",
    ...overrides,
  };
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

describe("pickTodayMilestoneTeaser", () => {
  it("returns most recent event within recency window", () => {
    const state: MilestoneState = {
      meta: { bootstrapped: true },
      peaks: {},
      events: [makeEvent("a", { achievedAt: daysAgo(2) })],
    };
    const result = pickTodayMilestoneTeaser(state, []);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("a");
  });

  it("returns null when no recent events", () => {
    const state: MilestoneState = {
      meta: { bootstrapped: true },
      peaks: {},
      events: [makeEvent("old", { achievedAt: daysAgo(30) })],
    };
    const result = pickTodayMilestoneTeaser(state, []);
    expect(result).toBeNull();
  });

  it("prefers newEvents over stored events", () => {
    const newEv = makeEvent("new", { achievedAt: daysAgo(0), magnitude: "major" });
    const state: MilestoneState = {
      meta: { bootstrapped: true },
      peaks: {},
      events: [makeEvent("old", { achievedAt: daysAgo(1) })],
    };
    const result = pickTodayMilestoneTeaser(state, [newEv]);
    expect(result!.id).toBe("new");
  });

  it("always shows major milestones regardless of weekly cap", () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      makeEvent(`minor-${i}`, { achievedAt: daysAgo(i), magnitude: "minor" }),
    );
    const major = makeEvent("major", { achievedAt: daysAgo(0), magnitude: "major" });
    const state: MilestoneState = {
      meta: { bootstrapped: true },
      peaks: {},
      events: [major, ...events],
    };
    const result = pickTodayMilestoneTeaser(state, []);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("major");
  });

  it("suppresses minor milestone when 3+ minors fired in past 7 days", () => {
    const events = Array.from({ length: 4 }, (_, i) =>
      makeEvent(`minor-${i}`, { achievedAt: daysAgo(i), magnitude: "minor" }),
    );
    const state: MilestoneState = {
      meta: { bootstrapped: true },
      peaks: {},
      events,
    };
    const result = pickTodayMilestoneTeaser(state, []);
    expect(result).toBeNull();
  });

  it("falls back to a recent major when minors exceed cap", () => {
    const minors = Array.from({ length: 4 }, (_, i) =>
      makeEvent(`minor-${i}`, { achievedAt: daysAgo(i), magnitude: "minor" }),
    );
    const major = makeEvent("major", { achievedAt: daysAgo(10), magnitude: "major" });
    const state: MilestoneState = {
      meta: { bootstrapped: true },
      peaks: {},
      events: [...minors, major],
    };
    const result = pickTodayMilestoneTeaser(state, []);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("major");
  });

  it("allows minor when fewer than 3 minors this week", () => {
    const events = [
      makeEvent("minor-0", { achievedAt: daysAgo(0), magnitude: "minor" }),
      makeEvent("minor-1", { achievedAt: daysAgo(3), magnitude: "minor" }),
    ];
    const state: MilestoneState = {
      meta: { bootstrapped: true },
      peaks: {},
      events,
    };
    const result = pickTodayMilestoneTeaser(state, []);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("minor-0");
  });
});

describe("filterMarketMilestones", () => {
  it("only returns market-relevant kinds", () => {
    const events = [
      makeEvent("a", { kind: "direct_competitor_lead_peak" }),
      makeEvent("b", { kind: "citation_daily_total" }),
      makeEvent("c", { kind: "corpus_owned_share_peak" }),
    ];
    const result = filterMarketMilestones(events);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("respects max limit", () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEvent(`m-${i}`, { kind: "platform_citation_share_peak" }),
    );
    const result = filterMarketMilestones(events, 3);
    expect(result).toHaveLength(3);
  });
});
