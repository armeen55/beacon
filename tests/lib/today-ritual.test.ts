import { describe, expect, it } from "vitest";
import { shouldShowTodayAllClear } from "@/lib/today-ritual";

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
});
