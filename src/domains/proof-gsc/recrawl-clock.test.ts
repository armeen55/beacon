import { describe, it, expect } from "vitest";
import { computeRecrawlClock, recrawlBlindSentence, type InspectionPoint, type SerpTitlePoint } from "./recrawl-clock";

const NOW = new Date("2026-07-02T12:00:00Z");

describe("computeRecrawlClock — pure, no I/O", () => {
  it("no liveAt ⇒ recrawlConfirmedAt null, basis none, daysBlind null", () => {
    const r = computeRecrawlClock({ liveAt: null, now: NOW });
    expect(r.recrawlConfirmedAt).toBeNull();
    expect(r.basis).toBe("none");
    expect(r.daysBlind).toBeNull();
    expect(r.hasInspectionHistory).toBe(false);
  });

  it("no inspections, no serp snapshots ⇒ basis none, daysBlind counts from liveAt to now", () => {
    // 2026-06-20T00:00Z -> 2026-07-02T12:00Z is 12.5 days, rounds to 13.
    const r = computeRecrawlClock({ liveAt: "2026-06-20T00:00:00Z", now: NOW });
    expect(r.recrawlConfirmedAt).toBeNull();
    expect(r.basis).toBe("none");
    expect(r.daysBlind).toBe(13);
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

  it("multiple post-liveAt inspections pick the EARLIEST one, not the most recent", () => {
    const inspections: InspectionPoint[] = [
      { lastCrawlTime: "2026-06-30T00:00:00Z", checkedAt: "2026-07-01T00:00:00Z" },
      { lastCrawlTime: "2026-06-25T00:00:00Z", checkedAt: "2026-06-26T00:00:00Z" },
      { lastCrawlTime: "2026-06-18T00:00:00Z", checkedAt: "2026-06-19T00:00:00Z" }, // pre-liveAt, ignored
    ];
    const r = computeRecrawlClock({ liveAt: "2026-06-20T00:00:00Z", inspections, now: NOW });
    expect(r.recrawlConfirmedAt).toBe("2026-06-25T00:00:00.000Z");
    expect(r.basis).toBe("inspection");
  });

  it("a lastCrawlTime of null on an inspection row is skipped, not treated as a match", () => {
    const inspections: InspectionPoint[] = [{ lastCrawlTime: null, checkedAt: "2026-06-27T00:00:00Z" }];
    const r = computeRecrawlClock({ liveAt: "2026-06-20T00:00:00Z", inspections, now: NOW });
    expect(r.recrawlConfirmedAt).toBeNull();
    expect(r.basis).toBe("none");
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

  it("serp_title fallback never fires without newTitle, even with matching snapshots", () => {
    const serpSnapshots: SerpTitlePoint[] = [
      { capturedAt: "2026-06-24T00:00:00Z", displayedTitle: "Something else entirely" },
    ];
    const r = computeRecrawlClock({ liveAt: "2026-06-20T00:00:00Z", serpSnapshots, now: NOW });
    expect(r.basis).toBe("none");
  });

  it("serp_title fallback ignores a snapshot whose title does not match the new title", () => {
    const serpSnapshots: SerpTitlePoint[] = [
      { capturedAt: "2026-06-24T00:00:00Z", displayedTitle: "Totally unrelated old title" },
    ];
    const r = computeRecrawlClock({
      liveAt: "2026-06-20T00:00:00Z",
      serpSnapshots,
      newTitle: "Best Persian Restaurants in Los Angeles",
      now: NOW,
    });
    expect(r.basis).toBe("none");
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
  it("null daysBlind renders the day-agnostic split-clock line", () => {
    expect(recrawlBlindSentence(null)).toBe(BASE);
  });
  it("0 daysBlind renders the same day-agnostic line", () => {
    expect(recrawlBlindSentence(0)).toBe(BASE);
  });
  it("names the SEARCH clock as waiting and the visit clock as already running (operator-corrected split)", () => {
    expect(recrawlBlindSentence(5)).toContain("so the search clock has not started");
    expect(recrawlBlindSentence(5)).toContain("Visit tracking started the day the change went live.");
  });
  it("never claims a live inspection happened - the signal is Google's index, not a live fetch", () => {
    expect(recrawlBlindSentence(null).toLowerCase()).not.toContain("inspect");
    expect(recrawlBlindSentence(9).toLowerCase()).not.toContain("inspect");
  });
  it("1 day uses singular", () => {
    expect(recrawlBlindSentence(1)).toMatch(/It has been 1 day since you shipped this\.$/);
  });
  it("plural days", () => {
    expect(recrawlBlindSentence(9)).toMatch(/It has been 9 days since you shipped this\.$/);
  });
  it("never emits an em or en dash", () => {
    expect(recrawlBlindSentence(null)).not.toMatch(/[–—]/);
    expect(recrawlBlindSentence(9)).not.toMatch(/[–—]/);
  });
});
