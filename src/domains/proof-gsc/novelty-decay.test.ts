import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeNoveltyDecay } from "./novelty-decay";
import type { DailyClickPoint } from "./weekday-baseline";
import { addDays } from "./measure";

/**
 * novelty-decay.test.ts (P4 R10a, v1 item 378) - pins the decay shape rule
 * (peak in week 1, back toward baseline by week 4), the minimum-peak floor so
 * a one-click wobble never reads as a faded jump, the sustained-win and
 * rising-shape negatives, and the 28-finalized-days requirement.
 */

const SHIP = "2026-05-01";
const BASELINE_START = addDays(SHIP, -28);

function series(baselineDaily: number, weeklyPost: [number, number, number, number]): DailyClickPoint[] {
  const out: DailyClickPoint[] = [];
  for (let i = 0; i < 28; i++) out.push({ date: addDays(BASELINE_START, i), clicks: baselineDaily });
  for (let i = 0; i < 28; i++) {
    out.push({ date: addDays(SHIP, i), clicks: weeklyPost[Math.floor(i / 7)] });
  }
  return out;
}

function run(weeklyPost: [number, number, number, number], over: Partial<Parameters<typeof computeNoveltyDecay>[0]> = {}) {
  return computeNoveltyDecay({
    series: series(10, weeklyPost),
    shipDate: SHIP,
    knownFrom: "2026-04-01",
    lastFinalizedDate: addDays(SHIP, 27),
    ...over,
  });
}

describe("computeNoveltyDecay", () => {
  it("a week-1 jump that fades back to baseline by week 4 flags noveltyDecay with the honest sentence", () => {
    const read = run([20, 15, 12, 10]);
    expect(read).not.toBeNull();
    expect(read!.noveltyDecay).toBe(true);
    expect(read!.weeklyLift).toEqual([10, 5, 2, 0]);
    expect(read!.sentence).toContain("The first week jump faded.");
    expect(read!.sentence).toContain("This looks like novelty, not a lasting win.");
    expect(read!.sentence).toContain("back to its old level");
  });

  it("a partial fade that still keeps residual lift names the week 4 number", () => {
    const read = run([20, 15, 12, 12]);
    expect(read).not.toBeNull();
    expect(read!.noveltyDecay).toBe(true);
    expect(read!.sentence).toContain("back to about 2 extra clicks a day");
  });

  it("a sustained win never flags (week 4 held the lift)", () => {
    const read = run([20, 20, 20, 20]);
    expect(read).not.toBeNull();
    expect(read!.noveltyDecay).toBe(false);
    expect(read!.sentence).toBeNull();
  });

  it("a rising shape never flags (week 1 was not the peak)", () => {
    const read = run([12, 14, 18, 22]);
    expect(read).not.toBeNull();
    expect(read!.noveltyDecay).toBe(false);
  });

  it("a tiny week-1 wobble below the peak floor never flags", () => {
    // +1 click a day on a 10-a-day page is below max(1, 0.2 * 10) = 2.
    const read = run([11, 10, 10, 10]);
    expect(read).not.toBeNull();
    expect(read!.noveltyDecay).toBe(false);
  });

  it("week 4 keeping more than 30 percent of the week 1 jump never flags (the retention boundary)", () => {
    // Week 1 lift 10, week 4 lift 4 = 40 percent retained -> not a fade.
    const read = run([20, 15, 13, 14]);
    expect(read).not.toBeNull();
    expect(read!.noveltyDecay).toBe(false);
  });

  it("returns null before 28 finalized post days exist", () => {
    const read = run([20, 15, 12, 10], { lastFinalizedDate: addDays(SHIP, 20) });
    expect(read).toBeNull();
  });

  it("returns null when the read does not cover the whole baseline window", () => {
    const read = run([20, 15, 12, 10], { knownFrom: "2026-04-10" });
    expect(read).toBeNull();
  });
});

describe("copy guard - dash-clean, no em or en dashes in source", () => {
  it("novelty-decay.ts contains no em or en dashes", () => {
    const src = readFileSync(join(__dirname, "novelty-decay.ts"), "utf8");
    expect(src.includes("\u2014")).toBe(false);
    expect(src.includes("\u2013")).toBe(false);
  });
});
