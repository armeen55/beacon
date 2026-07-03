import { describe, expect, it } from "vitest";
import { buildTodayGoalPace } from "./today-goal-pace";

const NOW = Date.parse("2026-07-03T18:00:00Z");

describe("buildTodayGoalPace", () => {
  it("returns null on a fresh empty tenant (no goal, nothing shipped/ready/measuring)", () => {
    const r = buildTodayGoalPace({ shippedThisWeek: 0, weeklyGoal: 0, ready: 0, measuring: 0, topReadyPage: null, nowMs: NOW });
    expect(r).toBeNull();
  });

  it("reads pace honestly with the gap remaining and gives a page-named ritual step", () => {
    const r = buildTodayGoalPace({ shippedThisWeek: 3, weeklyGoal: 5, ready: 2, measuring: 4, topReadyPage: "/cities", nowMs: NOW });
    expect(r).not.toBeNull();
    expect(r!.paceClause).toBe("You have shipped 3 of your 5 changes this week. Two left.");
    expect(r!.ritualClause).toContain("open the top change on /cities");
    expect(r!.ritualClause).toContain("About 20 minutes.");
    expect(r!.onTrack).toBe(false);
    expect(r!.href).toBe("#daily-experiments");
  });

  it("celebrates when the weekly goal is met, with a full progress bar", () => {
    const r = buildTodayGoalPace({ shippedThisWeek: 5, weeklyGoal: 5, ready: 0, measuring: 2, topReadyPage: null, nowMs: NOW });
    expect(r!.paceClause).toBe("You have shipped 5 of your 5 changes this week. Goal met.");
    expect(r!.onTrack).toBe(true);
    expect(r!.progress).toBe(1);
  });

  it("routes the ritual to measuring results when nothing is queued", () => {
    const r = buildTodayGoalPace({ shippedThisWeek: 4, weeklyGoal: 4, ready: 0, measuring: 3, topReadyPage: null, nowMs: NOW });
    expect(r!.ritualClause).toContain("still measuring");
    expect(r!.href).toBe("/results");
    expect(r!.actionLabel).toBe("See what is measuring");
  });

  it("routes the ritual to planning when nothing is ready or measuring", () => {
    const r = buildTodayGoalPace({ shippedThisWeek: 1, weeklyGoal: 1, ready: 0, measuring: 0, topReadyPage: null, nowMs: NOW });
    expect(r!.ritualClause).toContain("pick your next change");
    expect(r!.href).toBe("/changes");
  });

  it("reports raw pace with no denominator when no goal is set", () => {
    const r = buildTodayGoalPace({ shippedThisWeek: 0, weeklyGoal: 0, ready: 0, measuring: 3, topReadyPage: null, nowMs: NOW });
    expect(r!.paceClause).toBe("You have not shipped a change yet this week.");
    expect(r!.progress).toBe(0);
  });

  it("never emits an em or en dash", () => {
    const r = buildTodayGoalPace({ shippedThisWeek: 3, weeklyGoal: 5, ready: 2, measuring: 4, topReadyPage: "/cities", nowMs: NOW });
    expect(`${r!.paceClause}${r!.ritualClause}`).not.toMatch(/[‒–—―]/);
  });
});
