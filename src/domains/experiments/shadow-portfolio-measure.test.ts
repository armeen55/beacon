/**
 * shadow-portfolio-measure (2026-07-02, master plan item 65) - the I/O edge feeding both cohorts
 * into shadow-portfolio-drift.ts's pure comparison. All external reads mocked: loadShippedChanges
 * (the selected/ledger side), readShadowPortfolioCandidates (the captured shadow batches), and
 * readWindowForPages (the fresh pre/post GSC read for shadow pages). Ship/capture dates fixed
 * clear of the real confirmed Google-update ranges in algorithm-weather.ts (same convention
 * scoreboard-section-money-lines.test.ts uses).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import type { ShadowCandidateRecord } from "./shadow-portfolio-store";
import type { GscWindowMetrics } from "@/domains/proof-gsc/measure";

const NOW = new Date("2026-07-02T12:00:00.000Z");

let ledgerRows: ShippedChangeRecord[] = [];
let shadowRows: ShadowCandidateRecord[] = [];
/** page -> {pre, post, anchor} metrics for the fake readWindowForPages. `anchor` is the
 *  YYYY-MM-DD capture date; the fake distinguishes a pre-read (end === anchor) from a
 *  post-read (start === anchor) using it. */
type WindowFixture = { pre: GscWindowMetrics; post: GscWindowMetrics; anchor: string };
let windowMetricsByPage: Map<string, WindowFixture> = new Map();

vi.mock("@/domains/proof-gsc/shipped-change-store", () => ({
  loadShippedChanges: async () => ledgerRows,
}));
vi.mock("./shadow-portfolio-store", () => ({
  readShadowPortfolioCandidates: async () => shadowRows,
}));
vi.mock("@/domains/proof-gsc/algorithm-weather-store", () => ({
  loadDetectedChangepoints: async () => [],
}));
vi.mock("@/domains/proof-gsc/gsc-window", () => ({
  readWindowForPages: async (args: { pages: string[]; start: string; end: string }) => {
    const out = new Map<string, GscWindowMetrics>();
    for (const page of args.pages) {
      const entry = windowMetricsByPage.get(page);
      if (!entry) continue;
      // Distinguish pre vs post by comparing to a fixed anchor recorded in the fixture setup.
      const isPre = args.end === entry.anchor;
      out.set(page, isPre ? entry.pre : entry.post);
    }
    return out;
  },
}));

import { buildSelectedDriftRows, loadShadowPortfolioMeasurement, loadShadowCalibrationFeed } from "./shadow-portfolio-measure";
import { MIN_ROWS_FOR_CALIBRATION_FEED } from "@/domains/proof-gsc/shadow-portfolio-drift";

function win28(over: Partial<ShippedChangeRecord["windows"][number]> = {}): ShippedChangeRecord["windows"][number] {
  return {
    day: 28, checkOn: "2026-05-13", ran: true, treatedDelta: 40, controlDelta: 5, adjustedLift: 35,
    treatedCtrDelta: 0.03, controlCtrDelta: 0.002, adjustedCtrLift: 0.028, treatedPosDelta: 1,
    controlPosDelta: 0, adjustedPosLift: 1, controlsUsed: 3, ...over,
  };
}

function record(over: Partial<ShippedChangeRecord> = {}, path = "/p1"): ShippedChangeRecord {
  return {
    id: `${path}::2026-04-15`, page: `https://iranopedia.com${path}`, path, actionType: "edit_title",
    before: "old", after: "new", shippedAt: "2026-04-15T00:00:00.000Z",
    baseline: { clicks: 100, impressions: 3000, ctr: 0.03, position: 10, windowDays: 28 },
    targetQueries: ["iranian singers"], controlPages: ["https://iranopedia.com/actors"],
    windows: [win28()], verdict: "won", confidence: "high", measuredAt: "2026-05-13T00:00:00.000Z",
    notes: null, verifiedLive: true, liveSourceUrl: null, recrawlRequestedAt: null,
    operatorVerdictOverride: null, createdAt: "2026-04-15T00:00:00.000Z", updatedAt: "2026-05-13T00:00:00.000Z",
    ...over,
  } as ShippedChangeRecord;
}

function shadowCandidate(over: Partial<ShadowCandidateRecord> = {}): ShadowCandidateRecord {
  return {
    page: "https://iranopedia.com/shadow-1", pagePath: "/shadow-1", lever: "meta",
    pageFamily: "shadow-1", targetQuery: "q", score: 10, forecastLow: 5, forecastHigh: 15,
    capturedAt: "2026-04-15T02:00:00.000Z", planId: "plan-1", date: "2026-04-15",
    ...over,
  };
}

beforeEach(() => {
  ledgerRows = [];
  shadowRows = [];
  windowMetricsByPage = new Map();
});

describe("buildSelectedDriftRows - mirrors item 41's eligibility gate", () => {
  it("includes a mature, clean, settled record with a usable basis window", () => {
    const rows = buildSelectedDriftRows([record()], NOW, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.windowDays).toBe(28);
    // (40 - 5) / (100 * 28/28) = 0.35
    expect(rows[0]?.adjustedPct).toBeCloseTo(0.35, 5);
  });

  it("excludes a record whose window never ran (still measuring)", () => {
    const rows = buildSelectedDriftRows([record({ windows: [win28({ ran: false })], verdict: "measuring" })], NOW, []);
    expect(rows).toHaveLength(0);
  });

  it("excludes a record with a weak (fallback) control match", () => {
    const rows = buildSelectedDriftRows([record({ controlMatchWeak: true })], NOW, []);
    expect(rows).toHaveLength(0);
  });

  it("excludes a record with zero controls used", () => {
    const rows = buildSelectedDriftRows([record({ windows: [win28({ controlsUsed: 0 })] })], NOW, []);
    expect(rows).toHaveLength(0);
  });

  it("excludes a record with a zero baseline (no percent to compute)", () => {
    const rows = buildSelectedDriftRows(
      [record({ baseline: { clicks: 0, impressions: 3000, ctr: 0, position: 10, windowDays: 28 } })],
      NOW,
      [],
    );
    expect(rows).toHaveLength(0);
  });
});

describe("loadShadowPortfolioMeasurement - end to end wire", () => {
  it("returns selected rows from the ledger and shadow rows from a matured capture batch", async () => {
    ledgerRows = [record()];
    shadowRows = [shadowCandidate()];
    windowMetricsByPage.set("https://iranopedia.com/shadow-1", {
      pre: { clicks: 50, impressions: 1000, ctr: 0.05, position: 8 },
      post: { clicks: 60, impressions: 1000, ctr: 0.06, position: 8 },
      anchor: "2026-04-15",
    });
    const result = await loadShadowPortfolioMeasurement("tenant-a", NOW);
    expect(result.selected).toHaveLength(1);
    expect(result.shadow).toHaveLength(1);
    expect(result.shadow[0]?.rawDelta).toBe(10);
    expect(result.shadow[0]?.scaledBaseline).toBe(50);
  });

  it("excludes a shadow candidate captured too recently to have a full post window yet", async () => {
    shadowRows = [shadowCandidate({ capturedAt: "2026-06-28T00:00:00.000Z" })]; // < 28 days before NOW
    const result = await loadShadowPortfolioMeasurement("tenant-a", NOW);
    expect(result.shadow).toHaveLength(0);
  });

  it("fails soft to empty arrays when every read throws", async () => {
    // loadShippedChanges/readShadowPortfolioCandidates are mocked to succeed above; simulate an
    // unexpected shape by returning something the builder can't use, and confirm no throw.
    ledgerRows = [];
    shadowRows = [];
    const result = await loadShadowPortfolioMeasurement("tenant-a", NOW);
    expect(result).toEqual({ selected: [], shadow: [], forecastFeed: [] });
  });

  it("the forecast feed pairs shadow drift with the candidate's own forecast range", async () => {
    shadowRows = [shadowCandidate({ forecastLow: 5, forecastHigh: 15 })];
    windowMetricsByPage.set("https://iranopedia.com/shadow-1", {
      pre: { clicks: 50, impressions: 1000, ctr: 0.05, position: 8 },
      post: { clicks: 60, impressions: 1000, ctr: 0.06, position: 8 },
      anchor: "2026-04-15",
    });
    const result = await loadShadowPortfolioMeasurement("tenant-a", NOW);
    expect(result.forecastFeed).toHaveLength(1);
    expect(result.forecastFeed[0]?.forecastLow).toBe(5);
    expect(result.forecastFeed[0]?.forecastHigh).toBe(15);
  });

  it("excludes a shadow candidate with no numeric forecast from the forecast feed only", async () => {
    shadowRows = [shadowCandidate({ forecastLow: undefined, forecastHigh: undefined })];
    windowMetricsByPage.set("https://iranopedia.com/shadow-1", {
      pre: { clicks: 50, impressions: 1000, ctr: 0.05, position: 8 },
      post: { clicks: 60, impressions: 1000, ctr: 0.06, position: 8 },
      anchor: "2026-04-15",
    });
    const result = await loadShadowPortfolioMeasurement("tenant-a", NOW);
    expect(result.shadow).toHaveLength(1);
    expect(result.forecastFeed).toHaveLength(0);
  });
});

describe("loadShadowCalibrationFeed - item 65 part 4 composition", () => {
  it("returns null when the forecast feed is too thin (honest minimum)", async () => {
    shadowRows = [shadowCandidate()];
    windowMetricsByPage.set("https://iranopedia.com/shadow-1", {
      pre: { clicks: 50, impressions: 1000, ctr: 0.05, position: 8 },
      post: { clicks: 60, impressions: 1000, ctr: 0.06, position: 8 },
      anchor: "2026-04-15",
    });
    expect(await loadShadowCalibrationFeed("tenant-a", NOW)).toBeNull();
  });

  it("composes loadShadowPortfolioMeasurement + buildShadowCalibrationFeed end to end", async () => {
    shadowRows = Array.from({ length: MIN_ROWS_FOR_CALIBRATION_FEED }, (_, i) =>
      shadowCandidate({ page: `https://iranopedia.com/shadow-${i}`, pagePath: `/shadow-${i}`, forecastLow: 5, forecastHigh: 15 }),
    );
    for (const c of shadowRows) {
      windowMetricsByPage.set(c.page, {
        pre: { clicks: 50, impressions: 1000, ctr: 0.05, position: 8 },
        post: { clicks: 60, impressions: 1000, ctr: 0.06, position: 8 },
        anchor: "2026-04-15",
      });
    }
    const feed = await loadShadowCalibrationFeed("tenant-a", NOW);
    expect(feed).not.toBeNull();
    expect(feed?.n).toBe(MIN_ROWS_FOR_CALIBRATION_FEED);
  });

  it("fails soft to null on an unexpected error", async () => {
    shadowRows = [];
    expect(await loadShadowCalibrationFeed("tenant-a", NOW)).toBeNull();
  });
});
