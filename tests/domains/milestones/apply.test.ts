import { describe, it, expect } from "vitest";
import { applyMilestoneSync } from "@/domains/milestones/apply";
import type { MilestonePeakRow, MilestoneState } from "@/domains/milestones/types";

function peak(
  key: string,
  kind: MilestonePeakRow["kind"],
  value: number,
): MilestonePeakRow {
  return {
    key,
    kind,
    value,
    achievedAt: "2026-01-10T12:00:00.000Z",
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
});
