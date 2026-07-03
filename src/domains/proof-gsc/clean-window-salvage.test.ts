import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeCleanWindowSalvage, MIN_CLEAN_DAYS_FOR_SALVAGE } from "./clean-window-salvage";
import type { DailyClickPoint } from "./weekday-baseline";
import type { ShockWindow } from "./algorithm-weather";
import { addDays } from "./measure";

/**
 * clean-window-salvage.test.ts (P4 R10b, v1 item 152) - pins the day
 * partition (muddied inside a shock window, clean outside), the clean-days
 * lift math against a clean baseline, the 10-clean-day floors on both sides,
 * the honest-absence guards (no muddied day, unfinalized post window,
 * uncovered baseline), the confirmed/suspected labels, and the exact
 * salvage sentence.
 */

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

  it("a clean-days drop reads down, plainly", () => {
    const read = run({ series: series(10, 8) });
    expect(read?.cleanLiftPct).toBeCloseTo(-0.2, 5);
    expect(read?.sentence).toContain("is down 20 percent");
  });

  it("a clean-days wash reads about flat, never up 0 percent", () => {
    const read = run({ series: series(10, 10) });
    expect(read?.sentence).toContain("is about flat");
    expect(read?.sentence).not.toContain("0 percent");
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

  it("thin clean-baseline clicks fall back to the clicks phrasing instead of a shaky percent", () => {
    // Clean baseline pace ~0/day -> expected clean clicks under the floor.
    const read = run({ series: series(0, 2) });
    expect(read?.cleanLiftPct).toBeNull();
    expect(read?.sentence).toContain("is still ahead by about 38 clicks");
  });
});

describe("computeCleanWindowSalvage - labels", () => {
  it("a suspected sitewide shift gets the sitewide label, not the Google update one", () => {
    const read = run({ shocks: [shock(addDays(SHIP, 5), addDays(SHIP, 13), "suspected")] });
    expect(read?.shockKind).toBe("suspected");
    expect(read?.sentence).toContain("A sitewide shift muddied 9 of these 28 days");
  });

  it("confirmed wins the label when both kinds muddied the window", () => {
    const read = run({
      shocks: [
        shock(addDays(SHIP, 5), addDays(SHIP, 8), "suspected"),
        shock(addDays(SHIP, 10), addDays(SHIP, 13), "confirmed"),
      ],
    });
    expect(read?.shockKind).toBe("confirmed");
    expect(read?.sentence).toContain("A Google update");
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

  it("fewer than 10 clean BASELINE days is equally disqualifying", () => {
    // A shock swallowing nearly the whole baseline leaves too few clean
    // baseline days to name a usual pace.
    const read = run({
      shocks: [
        shock(addDays(SHIP, 5), addDays(SHIP, 13)),
        shock(BASELINE_START, addDays(SHIP, -9)),
      ],
    });
    expect(read).toBeNull();
  });

  it("an unfinalized post window is unknown, never zeros", () => {
    expect(run({ lastFinalizedDate: addDays(SHIP, 20) })).toBeNull();
    expect(run({ lastFinalizedDate: null })).toBeNull();
  });

  it("a series read that does not cover the whole baseline window is a guard null", () => {
    expect(run({ knownFrom: addDays(SHIP, -20) })).toBeNull();
  });

  it("a non-positive window is a guard null", () => {
    expect(run({ windowDays: 0 })).toBeNull();
  });
});

describe("copy guard - dash-clean, no lab words", () => {
  it("clean-window-salvage.ts contains no em or en dashes", () => {
    const src = readFileSync(join(__dirname, "clean-window-salvage.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });

  it("every salvage sentence across shapes is dash-clean and jargon-free", () => {
    const reads = [
      run(),
      run({ series: series(10, 8) }),
      run({ series: series(0, 2) }),
      run({ shocks: [shock(addDays(SHIP, 5), addDays(SHIP, 13), "suspected")] }),
    ];
    for (const r of reads) {
      if (!r) continue;
      expect(r.sentence).not.toMatch(/[–—]/);
      expect(r.sentence.toLowerCase()).not.toMatch(/baseline|quarantine|algorithm|shock/);
    }
  });
});
