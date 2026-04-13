import { describe, expect, it } from "vitest";
import { shouldShowTodayAllClear, computeTodayDigest } from "@/lib/today-ritual";

type AllClearParams = Parameters<typeof shouldShowTodayAllClear>[0];

describe("shouldShowTodayAllClear", () => {
  const ok: AllClearParams = {
    pendingFindingsCount: 0,
    hasPrimaryAction: false,
    primaryResponseStatus: undefined,
    crawlStale: false,
    visibilityStaleVsCrawl: false,
    coverageTone: "ok",
  };

  it("is true when no primary, no pending, fresh, tone ok", () => {
    expect(shouldShowTodayAllClear(ok)).toBe(true);
  });

  it("is false when pending findings exist", () => {
    expect(
      shouldShowTodayAllClear({ ...ok, pendingFindingsCount: 2 }),
    ).toBe(false);
  });

  it("is false when primary is deferred", () => {
    expect(
      shouldShowTodayAllClear({
        ...ok,
        hasPrimaryAction: true,
        primaryResponseStatus: "deferred",
      }),
    ).toBe(false);
  });

  it("is false when primary is unanswered (null)", () => {
    expect(
      shouldShowTodayAllClear({
        ...ok,
        hasPrimaryAction: true,
        primaryResponseStatus: null,
      }),
    ).toBe(false);
  });

  it("is true when primary is accepted", () => {
    expect(
      shouldShowTodayAllClear({
        ...ok,
        hasPrimaryAction: true,
        primaryResponseStatus: "accepted",
      }),
    ).toBe(true);
  });

  it("is true when primary is dismissed", () => {
    expect(
      shouldShowTodayAllClear({
        ...ok,
        hasPrimaryAction: true,
        primaryResponseStatus: "dismissed",
      }),
    ).toBe(true);
  });

  it("is false when crawl is stale", () => {
    expect(shouldShowTodayAllClear({ ...ok, crawlStale: true })).toBe(false);
  });

  it("is false when visibility is stale vs crawl", () => {
    expect(
      shouldShowTodayAllClear({ ...ok, visibilityStaleVsCrawl: true }),
    ).toBe(false);
  });

  it("is false when coverage tone is partial", () => {
    expect(
      shouldShowTodayAllClear({ ...ok, coverageTone: "partial" }),
    ).toBe(false);
  });

  it("is false when coverage state is critical", () => {
    expect(
      shouldShowTodayAllClear({ ...ok, coverageState: "critical" }),
    ).toBe(false);
  });

  it("is false when coverage state is stale", () => {
    expect(
      shouldShowTodayAllClear({ ...ok, coverageState: "stale" }),
    ).toBe(false);
  });

  it("is true when only coverage state is aging and other gates pass", () => {
    expect(
      shouldShowTodayAllClear({ ...ok, coverageState: "aging" }),
    ).toBe(true);
  });

  it("is false in demo / no-import workspace even when other criteria pass", () => {
    expect(shouldShowTodayAllClear({ ...ok, isDemoMode: true })).toBe(false);
    expect(
      shouldShowTodayAllClear({
        ...ok,
        hasPrimaryAction: true,
        primaryResponseStatus: "accepted",
        isDemoMode: true,
      }),
    ).toBe(false);
  });
});

describe("computeTodayDigest", () => {
  const base = {
    allClear: false,
    hasPrimaryAction: false,
    primaryResponseStatus: undefined as "accepted" | "dismissed" | "deferred" | null | undefined,
    actionableFindingsCount: 0,
    lowPriorityFindingsCount: 0,
    crawlStale: false,
  };

  it("returns null line when allClear", () => {
    const d = computeTodayDigest({ ...base, allClear: true });
    expect(d.criticalWorkDone).toBe(true);
    expect(d.line).toBeNull();
  });

  it("shows action remaining when primary is pending", () => {
    const d = computeTodayDigest({
      ...base,
      hasPrimaryAction: true,
      primaryResponseStatus: null,
    });
    expect(d.criticalWorkDone).toBe(false);
    expect(d.line).toContain("1 action remaining");
  });

  it("shows findings count when actionable findings exist", () => {
    const d = computeTodayDigest({ ...base, actionableFindingsCount: 3 });
    expect(d.criticalWorkDone).toBe(false);
    expect(d.line).toBe("3 findings to review");
  });

  it("combines action + findings + stale scan", () => {
    const d = computeTodayDigest({
      ...base,
      hasPrimaryAction: true,
      primaryResponseStatus: "deferred",
      actionableFindingsCount: 2,
      crawlStale: true,
    });
    expect(d.line).toBe("1 action remaining · 2 findings to review · scan overdue");
  });

  it("appends critical coverage hint to digest", () => {
    const d = computeTodayDigest({
      ...base,
      hasPrimaryAction: true,
      primaryResponseStatus: "deferred",
      coverageState: "critical",
    });
    expect(d.line).toContain("no recent crawl data");
  });

  it("appends stale coverage hint to digest", () => {
    const d = computeTodayDigest({
      ...base,
      actionableFindingsCount: 1,
      coverageState: "stale",
    });
    expect(d.line).toContain("data may be outdated");
  });

  it("shows optional items when only low-priority remain", () => {
    const d = computeTodayDigest({ ...base, lowPriorityFindingsCount: 4 });
    expect(d.criticalWorkDone).toBe(true);
    expect(d.line).toContain("All critical work complete");
    expect(d.line).toContain("4 optional items");
  });

  it("singular finding phrasing", () => {
    const d = computeTodayDigest({ ...base, actionableFindingsCount: 1 });
    expect(d.line).toBe("1 finding to review");
  });

  it("singular optional item phrasing", () => {
    const d = computeTodayDigest({ ...base, lowPriorityFindingsCount: 1 });
    expect(d.line).toContain("1 optional item remain");
  });

  it("does not count accepted primary as pending", () => {
    const d = computeTodayDigest({
      ...base,
      hasPrimaryAction: true,
      primaryResponseStatus: "accepted",
    });
    expect(d.criticalWorkDone).toBe(true);
    expect(d.line).toBeNull();
  });
});
