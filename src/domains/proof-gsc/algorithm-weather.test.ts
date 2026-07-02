/**
 * algorithm-weather (2026-07-02, master plan item 32) - shock-window assembly,
 * overlap logic (the piece measurement-maturity.ts and load-experiment-outcomes.ts
 * both pin their gate on), the caveat sentence, and the no-dash hard rule.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildShockWindows,
  confirmedShockWindows,
  suspectedShockWindows,
  overlappingShock,
  weatherCaveatSentence,
  type ShockWindow,
} from "./algorithm-weather";
import type { Changepoint } from "./changepoint";
import type { ConfirmedGoogleUpdate } from "./google-updates";

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

  it("defaults an open end to start + DEFAULT_ROLLOUT_DAYS", () => {
    const updates: ConfirmedGoogleUpdate[] = [{ id: "open-update", label: "the open update", start: "2026-05-01", end: "" }];
    const out = confirmedShockWindows(updates);
    expect(out[0]!.start).toBe("2026-05-01");
    expect(out[0]!.end).toBe("2026-05-15"); // +14 days
    expect(out[0]!.kind).toBe("confirmed");
  });

  it("skips malformed entries without a start date", () => {
    const updates = [{ id: "bad", label: "bad", start: "", end: "" }] as ConfirmedGoogleUpdate[];
    expect(confirmedShockWindows(updates)).toEqual([]);
  });

  it("empty list in -> empty list out", () => {
    expect(confirmedShockWindows([])).toEqual([]);
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

  it("detects an overlap with a suspected shock", () => {
    const hit = overlappingShock("2026-05-01", "2026-05-29", shocks);
    expect(hit?.kind).toBe("suspected");
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

  it("returns null for an empty or malformed window", () => {
    expect(overlappingShock("", "2026-03-10", shocks)).toBeNull();
    expect(overlappingShock("2026-03-10", "", shocks)).toBeNull();
  });

  it("returns null when there are no shocks at all", () => {
    expect(overlappingShock("2026-03-01", "2026-03-28", [])).toBeNull();
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

  it("stays empty (no shocks) for a flat, uneventful series with no confirmed updates", () => {
    const out = buildShockWindows({ dailySeries: weekdaySteady(60, 100), confirmedUpdates: [] });
    expect(out).toEqual([]);
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

describe("dash guard (hard rule)", () => {
  it("algorithm-weather.ts and google-updates.ts contain no em or en dashes", () => {
    for (const f of ["algorithm-weather.ts", "google-updates.ts", "algorithm-weather-store.ts"]) {
      const src = readFileSync(resolve(__dirname, f), "utf8");
      expect(src, `${f} must not contain em or en dashes`).not.toMatch(/[–—]/);
    }
  });
});
