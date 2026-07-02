import { describe, it, expect, vi } from "vitest";

import {
  resolveTargetQuery,
  pickWasRank,
  windowAlreadyRechecked,
  nextRecheckableWindow,
  runRankRecheck,
  MAX_RANK_RECHECKS_PER_PASS,
  type RunRankRecheckDeps,
} from "./rank-recheck";
import type { SerpRankPoint } from "@/domains/serp/serp-history";
import type { ShippedChangeRecord } from "./shipped-change-store";

function point(capturedAt: string, ownRank: number | null): SerpRankPoint {
  return { capturedAt, ownRank, ownUrl: ownRank != null ? "https://iranopedia.com/x" : null };
}

function baseChange(overrides: Partial<Pick<ShippedChangeRecord, "shippedAt" | "targetQueries" | "windows">> = {}) {
  return {
    shippedAt: "2026-06-01T00:00:00.000Z",
    targetQueries: ["persian singers"],
    windows: [],
    ...overrides,
  } as Pick<ShippedChangeRecord, "shippedAt" | "targetQueries" | "windows">;
}

describe("resolveTargetQuery", () => {
  it("picks the first non-empty target query", () => {
    expect(resolveTargetQuery({ targetQueries: ["  ", "persian singers", "other"] })).toBe("persian singers");
  });

  it("returns null when there is no usable target query", () => {
    expect(resolveTargetQuery({ targetQueries: [] })).toBeNull();
    expect(resolveTargetQuery({ targetQueries: ["   ", ""] })).toBeNull();
  });

  it("trims whitespace", () => {
    expect(resolveTargetQuery({ targetQueries: ["  persian singers  "] })).toBe("persian singers");
  });
});

describe("pickWasRank", () => {
  it("picks the earliest observed point within the window", () => {
    const points = [point("2026-06-04T00:00:00Z", 9), point("2026-06-02T00:00:00Z", 11), point("2026-06-10T00:00:00Z", 6)];
    const was = pickWasRank(points, "2026-06-01", 3);
    expect(was).toEqual({ rank: 11, capturedAt: "2026-06-02T00:00:00Z" });
  });

  it("ignores points with no observed own rank", () => {
    const points = [point("2026-06-01T12:00:00Z", null), point("2026-06-02T00:00:00Z", 8)];
    expect(pickWasRank(points, "2026-06-01", 3)).toEqual({ rank: 8, capturedAt: "2026-06-02T00:00:00Z" });
  });

  it("is honest silence when nothing was captured near ship", () => {
    const points = [point("2026-06-20T00:00:00Z", 5)]; // way outside the 3-day window
    expect(pickWasRank(points, "2026-06-01", 3)).toBeNull();
  });

  it("returns null for an unparseable ship date", () => {
    expect(pickWasRank([point("2026-06-02T00:00:00Z", 5)], "not-a-date")).toBeNull();
  });
});

describe("windowAlreadyRechecked", () => {
  it("is true once a history row lands on or after the check date", () => {
    const points = [point("2026-06-08T00:00:00Z", 4)];
    expect(windowAlreadyRechecked(points, "2026-06-08")).toBe(true);
    expect(windowAlreadyRechecked(points, "2026-06-09")).toBe(false);
  });

  it("is false with no history at all", () => {
    expect(windowAlreadyRechecked([], "2026-06-08")).toBe(false);
  });
});

describe("nextRecheckableWindow - the due-window machinery", () => {
  it("returns null before the 7-day window opens", () => {
    const change = baseChange({ shippedAt: "2026-06-01" });
    const now = new Date("2026-06-03T00:00:00Z");
    expect(nextRecheckableWindow(change, [], now)).toBeNull();
  });

  it("returns 7 once the 7-day window is open and unre-checked", () => {
    const change = baseChange({ shippedAt: "2026-06-01" });
    const now = new Date("2026-06-08T00:00:00Z");
    expect(nextRecheckableWindow(change, [], now)).toBe(7);
  });

  it("skips a window that already has a history row on/after its check date (idempotent)", () => {
    const change = baseChange({ shippedAt: "2026-06-01" });
    const now = new Date("2026-06-08T00:00:00Z");
    const points = [point("2026-06-08T00:00:00Z", 5)]; // the 7-day re-check already fired
    expect(nextRecheckableWindow(change, points, now)).toBeNull();
  });

  it("advances to 14 once 7 is already re-checked and 14 has opened", () => {
    const change = baseChange({ shippedAt: "2026-06-01" });
    const now = new Date("2026-06-15T00:00:00Z");
    const points = [point("2026-06-08T00:00:00Z", 5)]; // 7-day done
    expect(nextRecheckableWindow(change, points, now)).toBe(14);
  });

  it("never re-checks the same window twice even much later", () => {
    const change = baseChange({ shippedAt: "2026-06-01" });
    const now = new Date("2026-06-09T00:00:00Z");
    const points = [point("2026-06-08T12:00:00Z", 5)];
    expect(nextRecheckableWindow(change, points, now)).toBeNull();
  });

  it("returns null once all three windows are done", () => {
    const change = baseChange({ shippedAt: "2026-06-01" });
    const now = new Date("2026-08-01T00:00:00Z");
    const points = [point("2026-06-08T00:00:00Z", 5), point("2026-06-15T00:00:00Z", 5), point("2026-06-29T00:00:00Z", 4)];
    expect(nextRecheckableWindow(change, points, now)).toBeNull();
  });
});

function deps(overrides: Partial<RunRankRecheckDeps> = {}): Partial<RunRankRecheckDeps> {
  return {
    now: () => new Date("2026-06-08T12:00:00Z"),
    fetchSeries: async () => [point("2026-06-02T00:00:00Z", 9)],
    fetchFresh: async () => ({
      status: "ok",
      snapshot: { results: [{ rank: 4, domain: "iranopedia.com", url: "https://iranopedia.com/singers" }] },
    }),
    tenantDomain: async () => "iranopedia.com",
    ...overrides,
  };
}

describe("runRankRecheck - was/now math", () => {
  it("computes a real win: was 9, now 4, positive delta, honest sentence", async () => {
    const change = baseChange({ shippedAt: "2026-06-01" });
    const result = await runRankRecheck("tenant-iranopedia", change, 7, deps());
    expect(result).toEqual({
      window: 7,
      query: "persian singers",
      wasRank: 9,
      wasAt: "2026-06-02T00:00:00Z",
      nowRank: 4,
      nowAt: "2026-06-08T12:00:00.000Z",
      delta: 5,
      sentence: 'Google moved this page 9 to 4 for "persian singers" since the change.',
    });
  });

  it("reads a hold as a hold, not a fabricated move", async () => {
    const change = baseChange({ shippedAt: "2026-06-01" });
    const result = await runRankRecheck(
      "tenant-iranopedia",
      change,
      7,
      deps({
        fetchFresh: async () => ({
          status: "ok",
          snapshot: { results: [{ rank: 9, domain: "iranopedia.com", url: "https://iranopedia.com/singers" }] },
        }),
      }),
    );
    expect(result?.delta).toBe(0);
    expect(result?.sentence).toBe('Google has held this page at spot 9 for "persian singers" since the change.');
  });

  it("reads a drop honestly (a miss must not read as a win)", async () => {
    const change = baseChange({ shippedAt: "2026-06-01" });
    const result = await runRankRecheck(
      "tenant-iranopedia",
      change,
      7,
      deps({
        fetchFresh: async () => ({
          status: "ok",
          snapshot: { results: [{ rank: 15, domain: "iranopedia.com", url: "https://iranopedia.com/singers" }] },
        }),
      }),
    );
    expect(result?.delta).toBe(-6);
    expect(result?.sentence).toBe('Google moved this page 9 to 15 for "persian singers" since the change.');
  });

  it("stays silent (missing-was honesty) when there is no observed rank near ship", async () => {
    const change = baseChange({ shippedAt: "2026-06-01" });
    const result = await runRankRecheck("tenant-iranopedia", change, 7, deps({ fetchSeries: async () => [] }));
    expect(result).toBeNull();
  });

  it("stays silent when the page fell out of the tracked results (nowRank unknown), never fabricates 'gone'", async () => {
    const change = baseChange({ shippedAt: "2026-06-01" });
    const result = await runRankRecheck(
      "tenant-iranopedia",
      change,
      7,
      deps({ fetchFresh: async () => ({ status: "ok", snapshot: { results: [] } }) }),
    );
    expect(result?.nowRank).toBeNull();
    expect(result?.delta).toBeNull();
    expect(result?.sentence).toBeNull();
  });

  it("stays silent when no target query is known - never guesses", async () => {
    const change = baseChange({ targetQueries: [] });
    const result = await runRankRecheck("tenant-iranopedia", change, 7, deps());
    expect(result).toBeNull();
  });
});

describe("runRankRecheck - bounded, idempotent, dry-run/failure safe", () => {
  it("is idempotent: never re-checks the same window twice", async () => {
    const change = baseChange({ shippedAt: "2026-06-01" });
    const fetchFresh = vi.fn(async () => ({
      status: "ok",
      snapshot: { results: [{ rank: 4, domain: "iranopedia.com", url: "https://iranopedia.com/singers" }] },
    }));
    // History already has a row for the 7-day window's check date.
    const result = await runRankRecheck(
      "tenant-iranopedia",
      change,
      7,
      deps({
        fetchFresh,
        fetchSeries: async () => [point("2026-06-02T00:00:00Z", 9), point("2026-06-08T00:00:00Z", 4)],
      }),
    );
    expect(result).toBeNull();
    expect(fetchFresh).not.toHaveBeenCalled();
  });

  it("never spends when runSerpQuery is dry-run (status !== ok)", async () => {
    const change = baseChange({ shippedAt: "2026-06-01" });
    const result = await runRankRecheck(
      "tenant-iranopedia",
      change,
      7,
      deps({ fetchFresh: async () => ({ status: "dry_run", snapshot: null }) }),
    );
    expect(result).toBeNull();
  });

  it("fails soft when the fresh fetch throws", async () => {
    const change = baseChange({ shippedAt: "2026-06-01" });
    const result = await runRankRecheck(
      "tenant-iranopedia",
      change,
      7,
      deps({
        fetchFresh: async () => {
          throw new Error("network down");
        },
      }),
    );
    expect(result).toBeNull();
  });

  it("fails soft when the history read throws", async () => {
    const change = baseChange({ shippedAt: "2026-06-01" });
    const result = await runRankRecheck(
      "tenant-iranopedia",
      change,
      7,
      deps({
        fetchSeries: async () => {
          throw new Error("supabase down");
        },
      }),
    );
    expect(result).toBeNull(); // no "was" side available -> honest silence, never throws
  });

  it("fails soft when the tenant domain lookup throws (still resolves rank via null domain)", async () => {
    const change = baseChange({ shippedAt: "2026-06-01" });
    const result = await runRankRecheck(
      "tenant-iranopedia",
      change,
      7,
      deps({
        tenantDomain: async () => {
          throw new Error("no tenant context");
        },
      }),
    );
    // resolveOwnRank(_, null) can't match anything -> nowRank null -> honest silence sentence,
    // but the call itself must not throw.
    expect(result).not.toBeNull();
    expect(result?.nowRank).toBeNull();
  });

  it("MAX_RANK_RECHECKS_PER_PASS is the documented bound the batch callers enforce", () => {
    expect(MAX_RANK_RECHECKS_PER_PASS).toBe(8);
  });
});

describe("copy guard - no em or en dashes in any produced sentence", () => {
  const DASHES = /[–—]/;

  it("guards the win, hold, and drop sentences", async () => {
    const change = baseChange({ shippedAt: "2026-06-01" });
    const win = await runRankRecheck("tenant-iranopedia", change, 7, deps());
    const hold = await runRankRecheck(
      "tenant-iranopedia",
      change,
      7,
      deps({
        fetchFresh: async () => ({
          status: "ok",
          snapshot: { results: [{ rank: 9, domain: "iranopedia.com", url: "https://iranopedia.com/singers" }] },
        }),
      }),
    );
    const drop = await runRankRecheck(
      "tenant-iranopedia",
      change,
      7,
      deps({
        fetchFresh: async () => ({
          status: "ok",
          snapshot: { results: [{ rank: 20, domain: "iranopedia.com", url: "https://iranopedia.com/singers" }] },
        }),
      }),
    );
    for (const r of [win, hold, drop]) {
      expect(r?.sentence).toBeTruthy();
      expect(r!.sentence!).not.toMatch(DASHES);
    }
  });
});
