import { describe, it, expect } from "vitest";
import { applyMilestoneSync, classifyMagnitude } from "@/domains/milestones/apply";
import type { MilestonePeakRow, MilestoneState } from "@/domains/milestones/types";

function peak(
  key: string,
  kind: MilestonePeakRow["kind"],
  value: number,
  achievedAt = "2026-01-10T12:00:00.000Z",
): MilestonePeakRow {
  return {
    key,
    kind,
    value,
    achievedAt,
    proofSummary: "test",
  };
}

describe("applyMilestoneSync", () => {
  it("bootstraps silently with no events", () => {
    const prev: MilestoneState = { peaks: {}, events: [], meta: {} };
    const proposed = [peak("citation_daily_total", "citation_daily_total", 50)];
    const { state, newEvents, dirty } = applyMilestoneSync(prev, proposed);
    expect(dirty).toBe(true);
    expect(newEvents).toHaveLength(0);
    expect(state.meta?.bootstrapped).toBe(true);
    expect(state.peaks.citation_daily_total?.value).toBe(50);
  });

  it("emits an event when a peak is beaten after bootstrap", () => {
    const prev: MilestoneState = {
      meta: { bootstrapped: true },
      peaks: { citation_daily_total: peak("citation_daily_total", "citation_daily_total", 50) },
      events: [],
    };
    const proposed = [peak("citation_daily_total", "citation_daily_total", 80)];
    const { state, newEvents, dirty } = applyMilestoneSync(prev, proposed);
    expect(dirty).toBe(true);
    expect(newEvents).toHaveLength(1);
    expect(newEvents[0]!.key).toBe("citation_daily_total");
    expect(state.peaks.citation_daily_total?.value).toBe(80);
    expect(state.events).toHaveLength(1);
  });

  it("does not emit when value is unchanged", () => {
    const prev: MilestoneState = {
      meta: { bootstrapped: true },
      peaks: { citation_daily_total: peak("citation_daily_total", "citation_daily_total", 50) },
      events: [],
    };
    const proposed = [peak("citation_daily_total", "citation_daily_total", 50)];
    const { newEvents, dirty } = applyMilestoneSync(prev, proposed);
    expect(dirty).toBe(false);
    expect(newEvents).toHaveLength(0);
  });

  it("silently seeds topic_rank_best on first key", () => {
    const prev: MilestoneState = {
      meta: { bootstrapped: true },
      peaks: {},
      events: [],
    };
    const p = peak("topic_rank_best:foo", "topic_rank_best", 998);
    const { newEvents, dirty } = applyMilestoneSync(prev, [p]);
    expect(dirty).toBe(true);
    expect(newEvents).toHaveLength(0);
  });

  it("tags event as major when improvement >= 20%", () => {
    const prev: MilestoneState = {
      meta: { bootstrapped: true },
      peaks: { citation_daily_total: peak("citation_daily_total", "citation_daily_total", 50) },
      events: [],
    };
    const proposed = [peak("citation_daily_total", "citation_daily_total", 65)];
    const { newEvents } = applyMilestoneSync(prev, proposed);
    expect(newEvents).toHaveLength(1);
    expect(newEvents[0]!.magnitude).toBe("major");
  });

  it("tags event as minor when improvement < 20%", () => {
    const prev: MilestoneState = {
      meta: { bootstrapped: true },
      peaks: { citation_daily_total: peak("citation_daily_total", "citation_daily_total", 100) },
      events: [],
    };
    const proposed = [peak("citation_daily_total", "citation_daily_total", 110)];
    const { newEvents } = applyMilestoneSync(prev, proposed);
    expect(newEvents).toHaveLength(1);
    expect(newEvents[0]!.magnitude).toBe("minor");
  });

  it("tags first-time kinds as major regardless of value", () => {
    const prev: MilestoneState = {
      meta: { bootstrapped: true },
      peaks: {},
      events: [],
    };
    const proposed = [peak("topic_first_top3:x", "topic_first_top3", 1)];
    const { newEvents } = applyMilestoneSync(prev, proposed);
    expect(newEvents).toHaveLength(1);
    expect(newEvents[0]!.magnitude).toBe("major");
  });

  it("skips event emission on same-key-same-day duplicate", () => {
    const existingEvent = {
      id: "existing",
      kind: "citation_daily_total" as const,
      key: "citation_daily_total",
      title: "test",
      subtitle: "test",
      achievedAt: "2026-01-10T12:00:00.000Z",
      value: 60,
      proofSummary: "test",
    };
    const prev: MilestoneState = {
      meta: { bootstrapped: true },
      peaks: { citation_daily_total: peak("citation_daily_total", "citation_daily_total", 60) },
      events: [existingEvent],
    };
    const proposed = [peak("citation_daily_total", "citation_daily_total", 80, "2026-01-10T18:00:00.000Z")];
    const { state, newEvents, dirty } = applyMilestoneSync(prev, proposed);
    expect(dirty).toBe(true);
    expect(state.peaks.citation_daily_total?.value).toBe(80);
    expect(newEvents).toHaveLength(0);
  });

  it("allows event on different day for same key", () => {
    const existingEvent = {
      id: "existing",
      kind: "citation_daily_total" as const,
      key: "citation_daily_total",
      title: "test",
      subtitle: "test",
      achievedAt: "2026-01-09T12:00:00.000Z",
      value: 60,
      proofSummary: "test",
    };
    const prev: MilestoneState = {
      meta: { bootstrapped: true },
      peaks: { citation_daily_total: peak("citation_daily_total", "citation_daily_total", 60) },
      events: [existingEvent],
    };
    const proposed = [peak("citation_daily_total", "citation_daily_total", 80, "2026-01-10T12:00:00.000Z")];
    const { newEvents } = applyMilestoneSync(prev, proposed);
    expect(newEvents).toHaveLength(1);
  });
});

describe("classifyMagnitude", () => {
  it("returns major for first-time kinds", () => {
    expect(classifyMagnitude("topic_first_top3", 1, null)).toBe("major");
    expect(classifyMagnitude("topic_first_rank1", 1, 0)).toBe("major");
  });

  it("returns major when no previous value", () => {
    expect(classifyMagnitude("citation_daily_total", 50, null)).toBe("major");
  });

  it("returns major when previous is zero", () => {
    expect(classifyMagnitude("citation_daily_total", 50, 0)).toBe("major");
  });

  it("returns major for >= 20% improvement", () => {
    expect(classifyMagnitude("citation_daily_total", 120, 100)).toBe("major");
    expect(classifyMagnitude("citation_daily_total", 130, 100)).toBe("major");
  });

  it("returns minor for < 20% improvement", () => {
    expect(classifyMagnitude("citation_daily_total", 119, 100)).toBe("minor");
    expect(classifyMagnitude("citation_daily_total", 105, 100)).toBe("minor");
  });

  it("returns minor at exact 19% boundary", () => {
    expect(classifyMagnitude("citation_daily_total", 119, 100)).toBe("minor");
  });

  it("returns major at exact 20% boundary", () => {
    expect(classifyMagnitude("citation_daily_total", 120, 100)).toBe("major");
  });
});
