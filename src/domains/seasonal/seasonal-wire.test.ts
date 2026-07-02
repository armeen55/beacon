/**
 * seasonal-wire.test.ts (BEACON_500 item 63) - BEHAVIOR pins for the bounded additive seasonal
 * source inside buildDailyCandidates: emits a real "seasonal_prep" candidate from the peak
 * calendar, bounds at 2/night soonest-window-first, respects the shared eligibility gate (a
 * mid-measurement content-family page never queues), scores controls from the same clean pool
 * as every other lever, an ABSENT calendar produces a byte-identical batch (additive, never a
 * regression), and it never double-fires alongside a refresh candidate on the same page.
 */
import { describe, expect, it } from "vitest";

import { buildDailyCandidates, type GscPageInput, type PageFacts } from "@/domains/experiments/build-daily-candidates";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import type { RefreshBrief } from "../refresh/refresh-brief";
import type { PeakCalendarEntry } from "./seasonality";

const NOW = new Date("2026-07-02T00:00:00Z");
const gsc = (over: Partial<GscPageInput> & { url: string }): GscPageInput => ({
  pageLabel: "x", impressions: 2000, clicks: 5, ctr: 0.0025, position: 6,
  topQuery: "some other query", topQueryImpressions: 1200, topQueryPosition: 4, topQueryCtr: 0.002, ownership: 0.5, ...over,
});

function isoWeeksOut(weeks: number): string {
  return new Date(NOW.getTime() + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
}

function calendarEntry(page: string, over: Partial<PeakCalendarEntry> = {}): PeakCalendarEntry {
  return {
    clusterLabel: "Nowruz Table Setting",
    peakMonths: [3],
    confidence: "one_season",
    prepByDate: isoWeeksOut(1),
    peakStartDate: isoWeeksOut(7),
    expectedImpressions: 4000,
    topPage: page,
    sentence: "Searches climb every March.",
    ...over,
  };
}

// A family of clean sibling pages so controls exist (titles are query-first + meta present +
// H1 aligned -> chooseProposal yields NO candidate for them, keeping the batch seasonal-only).
function siblingPool(): { pages: GscPageInput[]; facts: Map<string, PageFacts> } {
  const pages: GscPageInput[] = [];
  const facts = new Map<string, PageFacts>();
  for (let i = 1; i <= 4; i++) {
    const url = `/iran-cats/sibling-${i}`;
    pages.push(gsc({ url, topQuery: `sibling query ${i}` }));
    facts.set(url, { title: `Sibling Query ${i} - Cats History`, meta: "A bespoke real meta for this page.", h1: `Sibling Query ${i}` });
  }
  return { pages, facts };
}

describe("buildDailyCandidates - item 63 seasonal source (wire behavior)", () => {
  it("emits a bounded seasonal_prep candidate from the calendar", () => {
    const { pages, facts } = siblingPool();
    const out = buildDailyCandidates({
      tenantId: "t", pages, facts, proofLedger: [], now: NOW,
      peakCalendar: [calendarEntry("/iran-cats/nowruz")],
    });
    const seasonal = out.filter((c) => c.leverField === "seasonal_prep");
    expect(seasonal).toHaveLength(1);
    const c = seasonal[0]!;
    expect(c.url).toBe("/iran-cats/nowruz");
    expect(c.actionFamily).toBe("content");
    expect(c.proposedText).toContain("Nowruz Table Setting");
    expect(c.whyNow).toContain("Nowruz Table Setting");
    expect(c.seasonalDetail?.clusterLabel).toBe("Nowruz Table Setting");
    expect(c.seasonalDetail?.confidence).toBe("one_season");
    expect(c.seasonalDetail?.peakMonths).toEqual([3]);
    // Controls come from the SAME clean pool machinery as every other lever.
    expect(c.suggestedControls.length).toBeGreaterThanOrEqual(3);
    expect(c.enoughControls).toBe(true);
    expect(c.eligibility.eligible).toBe(true);
  });

  it("bounds at 2 per night, calendar order preserved (soonest window first)", () => {
    const { pages, facts } = siblingPool();
    const out = buildDailyCandidates({
      tenantId: "t", pages, facts, proofLedger: [], now: NOW,
      peakCalendar: [
        calendarEntry("/iran-cats/first", { peakStartDate: isoWeeksOut(6) }),
        calendarEntry("/iran-cats/second", { peakStartDate: isoWeeksOut(7) }),
        calendarEntry("/iran-cats/third", { peakStartDate: isoWeeksOut(8) }),
      ],
    });
    const seasonal = out.filter((c) => c.leverField === "seasonal_prep");
    expect(seasonal.map((c) => c.url)).toEqual(["/iran-cats/first", "/iran-cats/second"]);
  });

  it("is silent for a calendar entry outside the 6-8 week lead window", () => {
    const { pages, facts } = siblingPool();
    const out = buildDailyCandidates({
      tenantId: "t", pages, facts, proofLedger: [], now: NOW,
      peakCalendar: [calendarEntry("/iran-cats/too-soon", { peakStartDate: isoWeeksOut(2) })],
    });
    expect(out.filter((c) => c.leverField === "seasonal_prep")).toHaveLength(0);
  });

  it("an ABSENT calendar is byte-identical to the pre-item-63 batch (additive only)", () => {
    const { pages, facts } = siblingPool();
    const without = buildDailyCandidates({ tenantId: "t", pages, facts, proofLedger: [], now: NOW });
    const withEmpty = buildDailyCandidates({ tenantId: "t", pages, facts, proofLedger: [], now: NOW, peakCalendar: [] });
    expect(withEmpty).toEqual(without);
    expect(without.filter((c) => c.leverField === "seasonal_prep")).toHaveLength(0);
  });

  it("a page mid-measurement on the content family never gets a seasonal candidate", () => {
    const { pages, facts } = siblingPool();
    const measuring: ShippedChangeRecord = {
      id: "p1", tenantId: "t", page: "/iran-cats/nowruz", path: "/iran-cats/nowruz",
      actionType: "add_h2_section", shippedAt: "2026-06-25T00:00:00Z", verdict: "measuring",
      controlPages: [], windows: [],
    } as unknown as ShippedChangeRecord;
    const out = buildDailyCandidates({
      tenantId: "t", pages, facts, proofLedger: [measuring], now: NOW,
      peakCalendar: [calendarEntry("/iran-cats/nowruz")],
    });
    expect(out.filter((c) => c.leverField === "seasonal_prep")).toHaveLength(0);
  });

  it("skips a calendar entry with no known top page (honesty gate)", () => {
    const { pages, facts } = siblingPool();
    const out = buildDailyCandidates({
      tenantId: "t", pages, facts, proofLedger: [], now: NOW,
      peakCalendar: [calendarEntry("/x", { topPage: null })],
    });
    expect(out.filter((c) => c.leverField === "seasonal_prep")).toHaveLength(0);
  });

  it("never double-fires alongside a refresh candidate already claiming the same page tonight", () => {
    const { pages, facts } = siblingPool();
    const fading: RefreshBrief = {
      page: "/iran-cats/nowruz",
      rank: {
        page: "/iran-cats/nowruz",
        clicksLostPerMonth: 60,
        clicksLostQuarter: 180,
        positionDrift: 1.5,
        priorClicks: 480,
        currentClicks: 300,
        priorPosition: 4.2,
        currentPosition: 5.7,
        currentImpressions: 3000,
        sentence: "This page earned 160 clicks a month last quarter and is fading, down about 60 clicks a month since. A refresh usually brings these back.",
      },
      newQueryGaps: [{ query: "nowruz table setting", impressions: 400 }],
      losingQueries: [],
      winnerSection: { domain: "rival.com", sectionTitle: "2026 Setting Guide", freshnessDate: "2026-02-01" },
      hasEvidence: true,
    };
    const out = buildDailyCandidates({
      tenantId: "t", pages, facts, proofLedger: [], now: NOW,
      refreshQueue: [fading],
      peakCalendar: [calendarEntry("/iran-cats/nowruz")],
    });
    const onThisPage = out.filter((c) => c.url === "/iran-cats/nowruz");
    expect(onThisPage).toHaveLength(1); // one card per page per night
    expect(onThisPage[0]!.leverField).toBe("refresh"); // refresh source runs first, claims the page
  });

  it("seasonal whyNow and proposed text carry no em or en dashes", () => {
    const { pages, facts } = siblingPool();
    const out = buildDailyCandidates({
      tenantId: "t", pages, facts, proofLedger: [], now: NOW,
      peakCalendar: [calendarEntry("/iran-cats/nowruz", { confidence: "proven" })],
    });
    const c = out.find((x) => x.leverField === "seasonal_prep")!;
    expect(c.whyNow).not.toMatch(/[–—]/);
    expect(c.proposedText).not.toMatch(/[–—]/);
  });
});
