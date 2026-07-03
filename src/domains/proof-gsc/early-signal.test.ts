import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeEarlySignal } from "./early-signal";
import type { DailyClickPoint } from "./weekday-baseline";
import { addDays } from "./measure";

/**
 * early-signal.test.ts (P4 R10a, v1 item 288) - pins the adaptive-window
 * READS: the 7-consecutive-day decisive boundary (6 days never fires), the
 * present-tense rule (a spike that already normalized never reads decisive),
 * the down direction, the 14-day futility read with its noise guard, and the
 * honest-absence guards. The flags are presentation + N10 confidence only -
 * the module has no access to windows/verdicts at all, which is the
 * structural guarantee the clock rules stay inviolable.
 */

const SHIP = "2026-05-01";
const BASELINE_START = addDays(SHIP, -28); // 2026-04-03

function series(baselinePerDay: (i: number) => number, postPerDay: number[]): DailyClickPoint[] {
  const out: DailyClickPoint[] = [];
  for (let i = 0; i < 28; i++) out.push({ date: addDays(BASELINE_START, i), clicks: baselinePerDay(i) });
  postPerDay.forEach((clicks, i) => out.push({ date: addDays(SHIP, i), clicks }));
  return out;
}

const flat10 = () => 10;

function run(postPerDay: number[], over: Partial<Parameters<typeof computeEarlySignal>[0]> = {}) {
  return computeEarlySignal({
    series: series(flat10, postPerDay),
    shipDate: SHIP,
    knownFrom: "2026-04-01",
    lastFinalizedDate: addDays(SHIP, postPerDay.length - 1),
    ...over,
  });
}

describe("computeEarlySignal - decisive", () => {
  it("7 consecutive far-above days read decisive up with the plain sentence", () => {
    const read = run([25, 25, 25, 25, 25, 25, 25]);
    expect(read).not.toBeNull();
    expect(read!.earlyDecisive).toBe(true);
    expect(read!.direction).toBe("up");
    expect(read!.qualifyingRunDays).toBe(7);
    expect(read!.sentence).toContain(
      "This is working so clearly I do not need the full 28 days to tell you.",
    );
    expect(read!.sentence).toContain("far above this page's normal range");
    expect(read!.sentence).toContain("The final call still waits for the full window.");
  });

  it("6 consecutive days is NOT decisive (the boundary)", () => {
    const read = run([25, 25, 25, 25, 25, 25]);
    expect(read).not.toBeNull();
    expect(read!.earlyDecisive).toBe(false);
    expect(read!.sentence).toBeNull();
  });

  it("7 far-below days read decisive down", () => {
    const read = run([0, 0, 0, 0, 0, 0, 0]);
    expect(read).not.toBeNull();
    expect(read!.earlyDecisive).toBe(true);
    expect(read!.direction).toBe("down");
    expect(read!.sentence).toContain("This is hurting so clearly");
    expect(read!.sentence).toContain("far below this page's normal range");
  });

  it("a spike that already normalized never reads decisive (present-tense rule)", () => {
    // 7 huge days, then the most recent finalized day is back to normal.
    const read = run([25, 25, 25, 25, 25, 25, 25, 10]);
    expect(read).not.toBeNull();
    expect(read!.earlyDecisive).toBe(false);
    expect(read!.qualifyingRunDays).toBe(0);
  });

  it("ordinary wobble on a flat page never flags (count-noise floor)", () => {
    // 12 clicks on a 10-a-day page is inside sqrt(10)*3 of normal.
    const read = run([12, 12, 12, 12, 12, 12, 12]);
    expect(read).not.toBeNull();
    expect(read!.earlyDecisive).toBe(false);
  });
});

describe("computeEarlySignal - futile", () => {
  it("14 flat post days on a steady page read early-futile", () => {
    const read = run(Array(14).fill(10));
    expect(read).not.toBeNull();
    expect(read!.earlyFutile).toBe(true);
    expect(read!.earlyDecisive).toBe(false);
    expect(read!.sentence).toContain("After 14 days this change is very unlikely to move this page");
    expect(read!.sentence).toContain("I will still let the full window finish");
  });

  it("13 days is not enough for a futility call (the boundary)", () => {
    const read = run(Array(13).fill(10));
    expect(read).not.toBeNull();
    expect(read!.earlyFutile).toBe(false);
    expect(read!.sentence).toBeNull();
  });

  it("a noisy page never reads futile off the same flat mean", () => {
    const noisyBaseline = (i: number) => (i % 2 === 0 ? 5 : 15);
    const noisyPost = Array.from({ length: 14 }, (_x, i) => (i % 2 === 0 ? 5 : 15));
    const read = computeEarlySignal({
      series: series(noisyBaseline, noisyPost),
      shipDate: SHIP,
      knownFrom: "2026-04-01",
      lastFinalizedDate: addDays(SHIP, 13),
    });
    expect(read).not.toBeNull();
    expect(read!.earlyFutile).toBe(false);
  });
});

describe("computeEarlySignal - honest absence", () => {
  it("null when no post-ship day has finalized yet", () => {
    const read = computeEarlySignal({
      series: series(flat10, []),
      shipDate: SHIP,
      knownFrom: "2026-04-01",
      lastFinalizedDate: addDays(SHIP, -1),
    });
    expect(read).toBeNull();
  });

  it("null when the read does not cover the whole baseline window", () => {
    const read = run([25, 25, 25, 25, 25, 25, 25], { knownFrom: "2026-04-10" });
    expect(read).toBeNull();
  });

  it("null with no finalized watermark at all", () => {
    const read = run([25], { lastFinalizedDate: null });
    expect(read).toBeNull();
  });

  it("reports how many finalized post days it actually saw", () => {
    const read = run([25, 25, 25]);
    expect(read!.postDaysRead).toBe(3);
  });
});

describe("copy guard - no lab words, no em or en dashes", () => {
  it("early-signal.ts contains no em or en dashes", () => {
    const src = readFileSync(join(__dirname, "early-signal.ts"), "utf8");
    expect(src.includes("\u2014")).toBe(false);
    expect(src.includes("\u2013")).toBe(false);
  });

  it('the operator sentences never say "standard deviation"', () => {
    const up = run([25, 25, 25, 25, 25, 25, 25])!.sentence!;
    const futile = run(Array(14).fill(10))!.sentence!;
    for (const s of [up, futile]) {
      expect(s.toLowerCase()).not.toContain("standard deviation");
      expect(s.toLowerCase()).not.toContain("sigma");
    }
  });
});
