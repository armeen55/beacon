/**
 * changepoint (2026-07-02, master plan item 32) - CUSUM matrix: a real step up, a
 * real step down, sustained drift, weekday-cyclic noise that must NOT fire, a
 * short series that must fail closed, and the no-dash hard rule.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { detectChangepoints, daysBetween, type DailyPoint } from "./changepoint";

const DAY_MS = 86_400_000;
const START = "2026-01-01"; // a Thursday

function d(offset: number): string {
  return new Date(Date.parse(`${START}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}

/** A steady baseline with mild, realistic weekday cyclicity (weekends ~30%
 *  lighter) but NO trend and NO real shift, for `days` days starting at day 0. */
function weekdaySteady(days: number, base = 100): DailyPoint[] {
  const out: DailyPoint[] = [];
  for (let i = 0; i < days; i++) {
    const wd = new Date(Date.parse(`${d(i)}T00:00:00Z`)).getUTCDay();
    const weekendFactor = wd === 0 || wd === 6 ? 0.7 : 1.0;
    out.push({ date: d(i), value: Math.round(base * weekendFactor) });
  }
  return out;
}

/** Small deterministic pseudo-noise (+/- a few percent), reproducible without a
 *  random seed dependency. */
function jitter(i: number, pct: number): number {
  // deterministic wobble in [-pct, +pct]
  return Math.sin(i * 1.7) * pct;
}

describe("detectChangepoints - step shifts", () => {
  it("flags a sustained +40% step up", () => {
    const pre = weekdaySteady(35, 100);
    const post = weekdaySteady(21, 140).map((p, i) => ({ ...p, date: d(35 + i) }));
    const series = [...pre, ...post];
    const out = detectChangepoints(series);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.direction).toBe("up");
    // The alarm should land at or after the actual shift date (day 35), never before.
    expect(daysBetween(d(35), out[0]!.date)).toBeGreaterThanOrEqual(0);
  });

  it("flags a sustained -35% step down", () => {
    const pre = weekdaySteady(35, 200);
    const post = weekdaySteady(21, 130).map((p, i) => ({ ...p, date: d(35 + i) }));
    const series = [...pre, ...post];
    const out = detectChangepoints(series);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.direction).toBe("down");
    expect(daysBetween(d(35), out[0]!.date)).toBeGreaterThanOrEqual(0);
  });

  it("does not fire on a mere 8% step (below the sustained-shift floor)", () => {
    const pre = weekdaySteady(35, 100);
    const post = weekdaySteady(21, 108).map((p, i) => ({ ...p, date: d(35 + i) }));
    const series = [...pre, ...post];
    expect(detectChangepoints(series)).toEqual([]);
  });

  it("catches a shift right at the documented >=20% target", () => {
    const pre = weekdaySteady(35, 100);
    const post = weekdaySteady(28, 122).map((p, i) => ({ ...p, date: d(35 + i) }));
    const series = [...pre, ...post];
    const out = detectChangepoints(series);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.direction).toBe("up");
  });
});

describe("detectChangepoints - drift (gradual, not a single-day spike)", () => {
  it("still catches a shift that ramps in over several days, not a single jump", () => {
    const pre = weekdaySteady(35, 100);
    const ramp: DailyPoint[] = [];
    for (let i = 0; i < 10; i++) {
      const level = 100 + (i / 9) * 45; // ramps 100 -> 145 over 10 days
      const wd = new Date(Date.parse(`${d(35 + i)}T00:00:00Z`)).getUTCDay();
      const weekendFactor = wd === 0 || wd === 6 ? 0.7 : 1.0;
      ramp.push({ date: d(35 + i), value: Math.round(level * weekendFactor) });
    }
    const post = weekdaySteady(15, 145).map((p, i) => ({ ...p, date: d(45 + i) }));
    const series = [...pre, ...ramp, ...post];
    const out = detectChangepoints(series);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.direction).toBe("up");
  });
});

describe("detectChangepoints - noise-only series never fires", () => {
  it("weekday-cyclic noise around a flat mean produces no changepoints", () => {
    const series = weekdaySteady(90, 100).map((p, i) => ({
      ...p,
      value: Math.max(0, Math.round(p.value * (1 + jitter(i, 0.06)))),
    }));
    expect(detectChangepoints(series)).toEqual([]);
  });

  it("a pure flat series (no noise, no shift) produces no changepoints", () => {
    const series = weekdaySteady(60, 250);
    expect(detectChangepoints(series)).toEqual([]);
  });
});

describe("detectChangepoints - short series fails closed", () => {
  it("returns [] when there is not enough history to trust a baseline", () => {
    const series = weekdaySteady(10, 100);
    expect(detectChangepoints(series)).toEqual([]);
  });

  it("returns [] for an empty series", () => {
    expect(detectChangepoints([])).toEqual([]);
  });

  it("ignores malformed points (bad dates / non-finite values) instead of throwing", () => {
    const series: DailyPoint[] = [
      ...weekdaySteady(30, 100),
      { date: "not-a-date", value: 9999 },
      { date: d(30), value: Number.NaN },
    ];
    expect(() => detectChangepoints(series)).not.toThrow();
  });
});

describe("detectChangepoints - one alarm per sustained shift", () => {
  it("does not re-alarm every day the level stays shifted", () => {
    const pre = weekdaySteady(35, 100);
    const post = weekdaySteady(40, 150).map((p, i) => ({ ...p, date: d(35 + i) }));
    const series = [...pre, ...post];
    const out = detectChangepoints(series);
    // A single sustained shift should not produce an alarm on every one of the
    // 40 post-shift days; the accumulator resets after firing.
    expect(out.length).toBeLessThan(10);
  });
});

describe("dash guard (hard rule)", () => {
  it("changepoint.ts contains no em or en dashes", () => {
    const src = readFileSync(resolve(__dirname, "changepoint.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });
});
