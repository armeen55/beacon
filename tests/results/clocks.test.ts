import { describe, it, expect, vi } from "vitest";
import { computeRecrawlClock, recrawlBlindSentence, type InspectionPoint, type SerpTitlePoint } from "@/domains/proof-gsc/recrawl-clock";
import {
  resolveTargetQuery,
  pickWasRank,
  windowAlreadyRechecked,
  nextRecheckableWindow,
  runRankRecheck,
  MAX_RANK_RECHECKS_PER_PASS,
  type RunRankRecheckDeps,
} from "@/domains/proof-gsc/rank-recheck";
import type { SerpRankPoint } from "@/domains/serp/serp-history";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";

describe("recrawl clock (pure): blind window and split-clock sentence", () => {
const NOW = new Date("2026-07-02T12:00:00Z");

describe("computeRecrawlClock — pure, no I/O", () => {
  it("no liveAt ⇒ recrawlConfirmedAt null, basis none, daysBlind null", () => {
    const r = computeRecrawlClock({ liveAt: null, now: NOW });
    expect(r.recrawlConfirmedAt).toBeNull();
    expect(r.basis).toBe("none");
    expect(r.daysBlind).toBeNull();
    expect(r.hasInspectionHistory).toBe(false);
  });

  it("an inspection BEFORE liveAt does not confirm anything (stale crawl of the old page)", () => {
    const inspections: InspectionPoint[] = [
      { lastCrawlTime: "2026-06-18T00:00:00Z", checkedAt: "2026-06-19T00:00:00Z" },
    ];
    const r = computeRecrawlClock({ liveAt: "2026-06-20T00:00:00Z", inspections, now: NOW });
    expect(r.recrawlConfirmedAt).toBeNull();
    expect(r.basis).toBe("none");
    expect(r.hasInspectionHistory).toBe(true); // we HAVE data, it just doesn't confirm
  });

  it("an inspection AFTER liveAt confirms - basis inspection, daysBlind counts to the confirm date", () => {
    const inspections: InspectionPoint[] = [
      { lastCrawlTime: "2026-06-26T00:00:00Z", checkedAt: "2026-06-27T00:00:00Z" },
    ];
    const r = computeRecrawlClock({ liveAt: "2026-06-20T00:00:00Z", inspections, now: NOW });
    expect(r.recrawlConfirmedAt).toBe("2026-06-26T00:00:00.000Z");
    expect(r.basis).toBe("inspection");
    expect(r.daysBlind).toBe(6);
    expect(r.hasInspectionHistory).toBe(true);
  });

  it("serp_title fallback: a post-liveAt snapshot showing the new title confirms when no inspection exists", () => {
    const serpSnapshots: SerpTitlePoint[] = [
      { capturedAt: "2026-06-24T00:00:00Z", displayedTitle: "Best Persian Restaurants in Los Angeles | Iranopedia" },
    ];
    const r = computeRecrawlClock({
      liveAt: "2026-06-20T00:00:00Z",
      serpSnapshots,
      newTitle: "Best Persian Restaurants in Los Angeles",
      now: NOW,
    });
    expect(r.basis).toBe("serp_title");
    expect(r.recrawlConfirmedAt).toBe("2026-06-24T00:00:00.000Z");
  });

  it("inspection basis wins over serp_title when both would confirm (strongest signal first)", () => {
    const inspections: InspectionPoint[] = [
      { lastCrawlTime: "2026-06-28T00:00:00Z", checkedAt: "2026-06-29T00:00:00Z" },
    ];
    const serpSnapshots: SerpTitlePoint[] = [
      { capturedAt: "2026-06-22T00:00:00Z", displayedTitle: "Best Persian Restaurants in Los Angeles" },
    ];
    const r = computeRecrawlClock({
      liveAt: "2026-06-20T00:00:00Z",
      inspections,
      serpSnapshots,
      newTitle: "Best Persian Restaurants in Los Angeles",
      now: NOW,
    });
    expect(r.basis).toBe("inspection");
  });

  it("daysBlind is never negative even with a slightly-future liveAt", () => {
    const r = computeRecrawlClock({ liveAt: "2026-07-03T00:00:00Z", now: NOW });
    expect(r.daysBlind).toBe(0);
  });
});

describe("recrawlBlindSentence — plain first-person, split-clock copy, no dashes", () => {
  const BASE =
    "Google has not re-read this page yet, so the search clock has not started. Visit tracking started the day the change went live.";
  it("names the SEARCH clock as waiting and the visit clock as already running (operator-corrected split)", () => {
    expect(recrawlBlindSentence(5)).toContain("so the search clock has not started");
    expect(recrawlBlindSentence(5)).toContain("Visit tracking started the day the change went live.");
  });
  it("never claims a live inspection happened - the signal is Google's index, not a live fetch", () => {
    expect(recrawlBlindSentence(null).toLowerCase()).not.toContain("inspect");
    expect(recrawlBlindSentence(9).toLowerCase()).not.toContain("inspect");
  });
});
});

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Row = Record<string, unknown>;
let inspectionRows: Row[] = [];
let readError: { code?: string; message?: string } | null = null;
let adminThrows = false;
const inCalls: unknown[][] = [];

function chainFor() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.in = vi.fn((_col: string, values: unknown[]) => {
    inCalls.push(values);
    if (readError) return Promise.resolve({ data: null, error: readError });
    return Promise.resolve({ data: inspectionRows, error: null });
  });
  return chain;
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (adminThrows) throw new Error("no supabase env");
    return { from: () => chainFor() };
  },
}));

import { attachRecrawlClockForLedger } from "@/domains/proof-gsc/attach-recrawl-clock";

const NOW = new Date("2026-07-02T12:00:00Z");

function reset() {
  inspectionRows = [];
  readError = null;
  adminThrows = false;
  inCalls.length = 0;
}

describe("attachRecrawlClockForLedger", () => {
  it("empty tenantId or no rows ⇒ empty map, no Supabase call", async () => {
    reset();
    const out1 = await attachRecrawlClockForLedger("", [{ id: "a", page: "https://x.com/a", shippedAt: "2026-06-20", actionType: "edit_meta", after: null }], NOW);
    expect(out1.size).toBe(0);
    const out2 = await attachRecrawlClockForLedger("tenant-1", [], NOW);
    expect(out2.size).toBe(0);
  });

  it("no Supabase admin (dev without keys) degrades to an empty map", async () => {
    reset();
    adminThrows = true;
    const out = await attachRecrawlClockForLedger(
      "tenant-1",
      [{ id: "a", page: "https://x.com/a", shippedAt: "2026-06-20", actionType: "edit_meta", after: null }],
      NOW,
    );
    expect(out.size).toBe(0);
  });

  it("a page with no inspection rows resolves with hasInspectionHistory=false, recrawlConfirmedAt null", async () => {
    reset();
    const out = await attachRecrawlClockForLedger(
      "tenant-1",
      [{ id: "a", page: "https://x.com/a", shippedAt: "2026-06-20", actionType: "edit_meta", after: null }],
      NOW,
    );
    const r = out.get("a")!;
    expect(r.hasInspectionHistory).toBe(false);
    expect(r.recrawlConfirmedAt).toBeNull();
    expect(r.basis).toBe("none");
  });

  it("a post-ship inspection row confirms recrawl for the matching page only", async () => {
    reset();
    inspectionRows = [
      { inspection_url: "https://x.com/a", last_crawl_time: "2026-06-25T00:00:00Z", last_checked_at: "2026-06-26T00:00:00Z" },
    ];
    const out = await attachRecrawlClockForLedger(
      "tenant-1",
      [
        { id: "a", page: "https://x.com/a", shippedAt: "2026-06-20", actionType: "edit_meta", after: null },
        { id: "b", page: "https://x.com/b", shippedAt: "2026-06-20", actionType: "edit_meta", after: null },
      ],
      NOW,
    );
    expect(out.get("a")!.recrawlConfirmedAt).toBe("2026-06-25T00:00:00.000Z");
    expect(out.get("a")!.basis).toBe("inspection");
    expect(out.get("b")!.recrawlConfirmedAt).toBeNull();
    expect(out.get("b")!.hasInspectionHistory).toBe(false);
  });

  it("newTitle is only threaded through for a title action type, from the row's own after text", async () => {
    reset();
    const out = await attachRecrawlClockForLedger(
      "tenant-1",
      [
        { id: "a", page: "https://x.com/a", shippedAt: "2026-06-20", actionType: "edit_title", after: "New Title Text" },
        { id: "b", page: "https://x.com/b", shippedAt: "2026-06-20", actionType: "add_answer_block", after: "Some answer text" },
      ],
      NOW,
    );
    // Neither has SERP snapshots wired (unimplemented data source), so both stay
    // basis "none" regardless - this test only pins that the call does not throw
    // and dedupes the query to the distinct pages requested.
    expect(out.get("a")!.basis).toBe("none");
    expect(out.get("b")!.basis).toBe("none");
    expect(inCalls[0]).toEqual(["https://x.com/a", "https://x.com/b"]);
  });

});

describe("rank recheck: due windows, was/now math, bounded paid re-check", () => {
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

});

describe("pickWasRank", () => {
  it("picks the earliest observed point within the window", () => {
    const points = [point("2026-06-04T00:00:00Z", 9), point("2026-06-02T00:00:00Z", 11), point("2026-06-10T00:00:00Z", 6)];
    const was = pickWasRank(points, "2026-06-01", 3);
    expect(was).toEqual({ rank: 11, capturedAt: "2026-06-02T00:00:00Z" });
  });

  it("is honest silence when nothing was captured near ship", () => {
    const points = [point("2026-06-20T00:00:00Z", 5)]; // way outside the 3-day window
    expect(pickWasRank(points, "2026-06-01", 3)).toBeNull();
  });

});

describe("windowAlreadyRechecked", () => {
  it("is true once a history row lands on or after the check date", () => {
    const points = [point("2026-06-08T00:00:00Z", 4)];
    expect(windowAlreadyRechecked(points, "2026-06-08")).toBe(true);
    expect(windowAlreadyRechecked(points, "2026-06-09")).toBe(false);
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

  it("MAX_RANK_RECHECKS_PER_PASS is the documented bound the batch callers enforce", () => {
    expect(MAX_RANK_RECHECKS_PER_PASS).toBe(8);
  });
});
});
