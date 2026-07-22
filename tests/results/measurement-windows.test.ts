import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  windowRole,
  windowCanSetVerdict,
  windowCanDemote,
  applyDemoteOnly56,
  DEFAULT_WINDOW_PLAN,
  PRIMARY_WINDOW_DAY,
} from "@/domains/proof-gsc/window-role";
import type { ProofWindowDay } from "@/domains/proof-gsc/measure";
import { computeWeekdayAdjustedLift, type DailyClickPoint } from "@/domains/proof-gsc/weekday-baseline";
import { addDays } from "@/domains/proof-gsc/measure";
import { computeCleanWindowSalvage, MIN_CLEAN_DAYS_FOR_SALVAGE } from "@/domains/proof-gsc/clean-window-salvage";
import { detectChangepoints, daysBetween, type DailyPoint } from "@/domains/proof-gsc/changepoint";
import {
  buildShockWindows,
  confirmedShockWindows,
  suspectedShockWindows,
  overlappingShock,
  weatherCaveatSentence,
  type ShockWindow,
} from "@/domains/proof-gsc/algorithm-weather";
import type { Changepoint } from "@/domains/proof-gsc/changepoint";
import type { ConfirmedGoogleUpdate } from "@/domains/proof-gsc/google-updates";

describe("window roles: 28 primary, 56 demote only, context windows", () => {
describe("windowRole - the verdict role of each window", () => {
  it("28 is the single PRIMARY (verdict-setting) window", () => {
    expect(windowRole(28)).toBe("primary");
    expect(PRIMARY_WINDOW_DAY).toBe(28);
  });

  it("56 is DEMOTE-ONLY (a won that did not hold, never an upgrade)", () => {
    expect(windowRole(56)).toBe("demote_only");
  });

  it("7, 14, and 84 are CONTEXT-only (never write the verdict enum)", () => {
    expect(windowRole(7)).toBe("context");
    expect(windowRole(14)).toBe("context");
    expect(windowRole(84)).toBe("context");
  });

  it("only the primary window may set the verdict enum", () => {
    expect(windowCanSetVerdict(28)).toBe(true);
    for (const d of [7, 14, 56, 84] as ProofWindowDay[]) {
      expect(windowCanSetVerdict(d)).toBe(false);
    }
  });

  it("only the demote-only window may take a won away", () => {
    expect(windowCanDemote(56)).toBe(true);
    for (const d of [7, 14, 28, 84] as ProofWindowDay[]) {
      expect(windowCanDemote(d)).toBe(false);
    }
  });
});

describe("DEFAULT_WINDOW_PLAN - the plan every ship predeclares (protocol 4.2)", () => {
  it("is exactly 7 context, 14 context, 28 primary, 56 demote_only, 84 context", () => {
    expect(DEFAULT_WINDOW_PLAN).toEqual([
      { day: 7, role: "context" },
      { day: 14, role: "context" },
      { day: 28, role: "primary" },
      { day: 56, role: "demote_only" },
      { day: 84, role: "context" },
    ]);
  });

  it("every entry's role agrees with windowRole (no drift between plan and helper)", () => {
    for (const entry of DEFAULT_WINDOW_PLAN) {
      expect(entry.role).toBe(windowRole(entry.day));
    }
  });

  it("has exactly one primary window", () => {
    expect(DEFAULT_WINDOW_PLAN.filter((e) => e.role === "primary")).toHaveLength(1);
  });
});

describe("applyDemoteOnly56 - the demote-only 56 day rule", () => {
  it("demotes a won that did NOT hold to inconclusive", () => {
    const r = applyDemoteOnly56({ primaryVerdict: "won", heldAt56: false });
    expect(r.verdict).toBe("inconclusive");
    expect(r.demoted).toBe(true);
  });

  it("leaves a won that HELD untouched", () => {
    const r = applyDemoteOnly56({ primaryVerdict: "won", heldAt56: true });
    expect(r.verdict).toBe("won");
    expect(r.demoted).toBe(false);
    expect(r.provisional).toBe(false);
  });

  it("NEVER upgrades: a lost or inconclusive at 28 is unchanged regardless of the 56 read", () => {
    for (const primaryVerdict of ["lost", "inconclusive", "insufficient_data", "measuring"] as const) {
      for (const heldAt56 of [true, false]) {
        const r = applyDemoteOnly56({ primaryVerdict, heldAt56 });
        expect(r.verdict).toBe(primaryVerdict);
        expect(r.demoted).toBe(false);
      }
    }
  });

  it("flags a demotion PROVISIONAL until 56 day placebo history supports the window", () => {
    // Default (no support) -> provisional.
    expect(applyDemoteOnly56({ primaryVerdict: "won", heldAt56: false }).provisional).toBe(true);
    // Explicitly unsupported -> provisional.
    expect(
      applyDemoteOnly56({ primaryVerdict: "won", heldAt56: false, placeboHistorySupports56: false })
        .provisional,
    ).toBe(true);
    // Supported -> a demotion is no longer provisional.
    expect(
      applyDemoteOnly56({ primaryVerdict: "won", heldAt56: false, placeboHistorySupports56: true })
        .provisional,
    ).toBe(false);
  });
});
});

describe("weekday-aligned baseline: median per weekday vs raw mean", () => {
const SHIP = "2026-05-31"; // Sunday
const BASELINE_START = addDays(SHIP, -28); // 2026-05-03, Sunday

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function seriesBetween(
  start: string,
  days: number,
  clicksFor: (date: string, weekday: number) => number,
): DailyClickPoint[] {
  const out: DailyClickPoint[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    out.push({ date, clicks: clicksFor(date, weekdayOf(date)) });
  }
  return out;
}

const base = {
  shipDate: SHIP,
  windowDays: 7,
  preWindowDays: 28,
  knownFrom: "2026-05-01",
  lastFinalizedDate: "2026-06-10",
};

describe("computeWeekdayAdjustedLift", () => {
  it("one baseline spike day skews the raw mean; the weekday medians read the flat page honestly", () => {
    // Baseline: flat 10/day except one 290-click viral day. Post week: flat 12/day.
    const series = [
      ...seriesBetween(BASELINE_START, 28, (date) => (date === "2026-05-12" ? 290 : 10)),
      ...seriesBetween(SHIP, 7, () => 12),
    ];
    const read = computeWeekdayAdjustedLift({ ...base, series });
    expect(read).not.toBeNull();
    // Raw: 84 post clicks minus (560/28)*7 = 140 expected -> -56 ("fell").
    expect(read!.rawLift).toBe(-56);
    // Aligned: every weekday median is 10 -> 7 * (12 - 10) = +14 ("grew").
    expect(read!.weekdayAdjustedLift).toBe(14);
    expect(read!.preferAdjusted).toBe(true);
    // No weekend pattern here (all medians 10) -> the generic unusual-days reason.
    expect(read!.sentence).toContain("A few unusual days skew the plain average");
    expect(read!.sentence).toContain("+14 clicks over 7 days, not -56");
  });

  it("a missing date inside covered, finalized ranges is an honest zero", () => {
    // Baseline series omits 2026-05-05 entirely (no GSC row = no impressions).
    const series = [
      ...seriesBetween(BASELINE_START, 28, () => 10).filter((p) => p.date !== "2026-05-05"),
      ...seriesBetween(SHIP, 7, () => 10),
    ];
    const read = computeWeekdayAdjustedLift({ ...base, series });
    expect(read).not.toBeNull();
    // Raw expectation drops by 10/28*7 = 2.5 -> rawLift +2.5 off the missing day.
    expect(read!.rawLift).toBe(2.5);
  });

  it("returns null when the series read does not cover the whole baseline window", () => {
    const series = [
      ...seriesBetween(BASELINE_START, 28, () => 10),
      ...seriesBetween(SHIP, 7, () => 12),
    ];
    const read = computeWeekdayAdjustedLift({ ...base, series, knownFrom: "2026-05-10" });
    expect(read).toBeNull();
  });

  it("returns null when GSC has not finalized the whole post window (days past the watermark are unknown, not zero)", () => {
    const series = [
      ...seriesBetween(BASELINE_START, 28, () => 10),
      ...seriesBetween(SHIP, 7, () => 12),
    ];
    const read = computeWeekdayAdjustedLift({
      ...base,
      series,
      lastFinalizedDate: addDays(SHIP, 3),
    });
    expect(read).toBeNull();
  });

});
});

describe("clean-window salvage: muddied vs clean day partition", () => {
const SHIP = "2026-05-01";
const BASELINE_START = addDays(SHIP, -28);

function shock(start: string, end: string, kind: "confirmed" | "suspected" = "confirmed"): ShockWindow {
  return { id: `${kind}:${start}`, start, end, kind, label: kind === "confirmed" ? "a Google core update" : "a sitewide shift I detected" };
}

/** 28 baseline days at `baselineDaily`, then 28 post days from `post` (or a
 *  constant). Dates and clicks fully explicit so partitions are exact. */
function series(baselineDaily: number, post: number[] | number): DailyClickPoint[] {
  const out: DailyClickPoint[] = [];
  for (let i = 0; i < 28; i++) out.push({ date: addDays(BASELINE_START, i), clicks: baselineDaily });
  for (let i = 0; i < 28; i++) {
    out.push({ date: addDays(SHIP, i), clicks: Array.isArray(post) ? post[i] : post });
  }
  return out;
}

function run(over: Partial<Parameters<typeof computeCleanWindowSalvage>[0]> = {}) {
  return computeCleanWindowSalvage({
    series: series(10, 12),
    shipDate: SHIP,
    windowDays: 28,
    knownFrom: "2026-03-01",
    lastFinalizedDate: addDays(SHIP, 27),
    shocks: [shock(addDays(SHIP, 5), addDays(SHIP, 13))], // muddies post days 5..13 = 9 days
    ...over,
  });
}

describe("computeCleanWindowSalvage - the day partition and clean-days lift", () => {
  it("partitions muddied vs clean days and reads the lift on the clean days alone", () => {
    // Baseline 10/day. Post: 12/day on clean days, 99/day inside the shock
    // (the muddied days must NOT leak into the salvage read).
    const post = Array.from({ length: 28 }, (_, i) => (i >= 5 && i <= 13 ? 99 : 12));
    const read = run({ series: series(10, post) });
    expect(read).not.toBeNull();
    expect(read?.muddiedDays).toBe(9);
    expect(read?.cleanDays).toBe(19);
    // Clean mean 12 vs clean baseline mean 10 -> up 20 percent, +2 x 19 days.
    expect(read?.cleanLiftPct).toBeCloseTo(0.2, 5);
    expect(read?.cleanLiftClicks).toBeCloseTo(38, 1);
    expect(read?.sentence).toBe(
      "A Google update muddied 9 of these 28 days; on the 19 clean days this change is still up 20 percent.",
    );
  });

  it("excludes shock days from the BASELINE pace too (a muddied baseline must not fake a lift)", () => {
    // A second shock sits inside the baseline: days -10..-3 spike to 100.
    // With those days excluded the clean baseline stays 10/day and the read
    // is +20 percent; if they leaked in, the inflated pace would read a drop.
    const spiky = series(10, 12).map((p) =>
      p.date >= addDays(SHIP, -10) && p.date <= addDays(SHIP, -3) ? { ...p, clicks: 100 } : p,
    );
    const read = run({
      series: spiky,
      shocks: [
        shock(addDays(SHIP, 5), addDays(SHIP, 13)),
        shock(addDays(SHIP, -10), addDays(SHIP, -3), "suspected"),
      ],
    });
    expect(read?.cleanLiftPct).toBeCloseTo(0.2, 5);
  });

});


describe("computeCleanWindowSalvage - honest absence", () => {
  it("no shock touching the window means nothing to salvage", () => {
    expect(run({ shocks: [shock("2026-08-01", "2026-08-10")] })).toBeNull();
    expect(run({ shocks: [] })).toBeNull();
  });

  it("fewer than 10 clean days inside the window is a sliver, not a read", () => {
    // Shock covers post days 0..18 -> 9 clean days left.
    expect(run({ shocks: [shock(SHIP, addDays(SHIP, 18))] })).toBeNull();
    // 10 clean days (shock covers 0..17) is exactly enough.
    expect(run({ shocks: [shock(SHIP, addDays(SHIP, 17))] })).not.toBeNull();
    expect(MIN_CLEAN_DAYS_FOR_SALVAGE).toBe(10);
  });

  it("an unfinalized post window is unknown, never zeros", () => {
    expect(run({ lastFinalizedDate: addDays(SHIP, 20) })).toBeNull();
    expect(run({ lastFinalizedDate: null })).toBeNull();
  });

});
});

describe("changepoint detection: sustained shifts fire, noise never does", () => {
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

});

describe("detectChangepoints - short series fails closed", () => {
  it("returns [] when there is not enough history to trust a baseline", () => {
    const series = weekdaySteady(10, 100);
    expect(detectChangepoints(series)).toEqual([]);
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

});

describe("algorithm weather: shock windows and overlap", () => {
describe("confirmedShockWindows", () => {
  it("uses the update's own end date when present", () => {
    const updates: ConfirmedGoogleUpdate[] = [
      { id: "test-update", label: "the test update", start: "2026-03-01", end: "2026-03-14" },
    ];
    const out = confirmedShockWindows(updates);
    expect(out).toEqual([
      { id: "confirmed:test-update", start: "2026-03-01", end: "2026-03-14", kind: "confirmed", label: "the test update" },
    ]);
  });

});

describe("suspectedShockWindows", () => {
  it("spreads a changepoint into a window before and after the alarm date", () => {
    const cps: Changepoint[] = [{ date: "2026-04-10", direction: "up", magnitude: 0.6 }];
    const out = suspectedShockWindows(cps);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("suspected");
    expect(out[0]!.direction).toBe("up");
    expect(out[0]!.start < "2026-04-10").toBe(true);
    expect(out[0]!.end > "2026-04-10").toBe(true);
  });
});

describe("overlappingShock", () => {
  const shocks: ShockWindow[] = [
    { id: "confirmed:a", start: "2026-03-01", end: "2026-03-14", kind: "confirmed", label: "the March update" },
    { id: "suspected:2026-05-10:up", start: "2026-05-07", end: "2026-05-20", kind: "suspected", label: "a sitewide shift I detected" },
  ];

  it("returns null when the measurement window is entirely clear", () => {
    expect(overlappingShock("2026-01-01", "2026-01-28", shocks)).toBeNull();
  });

  it("detects an overlap with a confirmed update", () => {
    const hit = overlappingShock("2026-02-25", "2026-03-25", shocks);
    expect(hit?.kind).toBe("confirmed");
    expect(hit?.id).toBe("confirmed:a");
  });

  it("prefers a confirmed hit over a suspected hit when a window overlaps both", () => {
    const bothShocks: ShockWindow[] = [
      { id: "suspected:x", start: "2026-06-01", end: "2026-06-20", kind: "suspected", label: "a sitewide shift I detected" },
      { id: "confirmed:y", start: "2026-06-10", end: "2026-06-25", kind: "confirmed", label: "the June update" },
    ];
    const hit = overlappingShock("2026-06-05", "2026-06-30", bothShocks);
    expect(hit?.kind).toBe("confirmed");
  });

  it("treats a window that touches only the boundary date as overlapping (inclusive)", () => {
    const hit = overlappingShock("2026-03-14", "2026-04-11", shocks);
    expect(hit?.id).toBe("confirmed:a");
  });

});

describe("buildShockWindows", () => {
  const DAY_MS = 86_400_000;
  function d(offset: number): string {
    return new Date(Date.parse("2026-01-01T00:00:00Z") + offset * DAY_MS).toISOString().slice(0, 10);
  }
  function weekdaySteady(days: number, base: number) {
    return Array.from({ length: days }, (_, i) => {
      const wd = new Date(Date.parse(`${d(i)}T00:00:00Z`)).getUTCDay();
      const factor = wd === 0 || wd === 6 ? 0.7 : 1.0;
      return { date: d(i), value: Math.round(base * factor) };
    });
  }

  it("merges confirmed updates with freshly detected changepoints from a real series", () => {
    const pre = weekdaySteady(35, 100);
    const post = weekdaySteady(30, 150).map((p, i) => ({ ...p, date: d(35 + i) }));
    const confirmedUpdates: ConfirmedGoogleUpdate[] = [
      { id: "seed", label: "the seeded update", start: "2020-01-01", end: "2020-01-14" },
    ];
    const out = buildShockWindows({ dailySeries: [...pre, ...post], confirmedUpdates });
    expect(out.some((s) => s.kind === "confirmed" && s.id === "confirmed:seed")).toBe(true);
    expect(out.some((s) => s.kind === "suspected")).toBe(true);
  });

  it("merges in prior changepoints (from a persisted store) without duplicating a fresh hit", () => {
    const pre = weekdaySteady(35, 100);
    const post = weekdaySteady(30, 150).map((p, i) => ({ ...p, date: d(35 + i) }));
    const series = [...pre, ...post];
    const fresh = buildShockWindows({ dailySeries: series });
    const freshSuspected = fresh.filter((s) => s.kind === "suspected");
    // A prior changepoint identical to the fresh one should not double up.
    const dup: Changepoint[] = freshSuspected.length
      ? [{ date: freshSuspected[0]!.id.split(":")[1]!, direction: freshSuspected[0]!.direction!, magnitude: 0.5 }]
      : [];
    const withPrior = buildShockWindows({ dailySeries: series, priorChangepoints: dup });
    expect(withPrior.filter((s) => s.kind === "suspected").length).toBe(freshSuspected.length);
  });

});

describe("weatherCaveatSentence", () => {
  it("names the plain date and reads as first person, no dashes", () => {
    const s = weatherCaveatSentence({
      id: "confirmed:x",
      start: "2026-07-08",
      end: "2026-07-22",
      kind: "confirmed",
      label: "the July update",
    });
    expect(s).toContain("Jul 8");
    expect(s).toContain("I am reading this result cautiously");
    expect(s).not.toMatch(/[–—]/);
  });
});

});
